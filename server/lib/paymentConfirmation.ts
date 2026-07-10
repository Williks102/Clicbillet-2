import { isSupabaseEnabled, supabase } from "./config";
import { getDB, saveDB } from "./db";
import { runInBackground } from "./utils";
import { sendTicketEmail, sendPaymentFailedEmail } from "./email";
import { releaseWaitingRoomSlot } from "./waitingRoom";

// Callback / Webhook endpoint pour recevoir les notifications de Paiement Pro (CI)
export function normalizeReferenceIdentifier(value: any): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.split(/[?&]/)[0].trim();
}

/**
 * RÉSOLUTION + CONFIRMATION DE PAIEMENT PAR RÉFÉRENCE
 *
 * Une commande (order_id, format ORD-xxxxx, c'est la référence envoyée à PaiementPro) peut
 * regrouper plusieurs lignes "tickets" (un type de billet par ligne, ex: 2 Standard + 1 VIP).
 * Ces trois fonctions sont partagées par les trois points d'entrée qui confirment un
 * paiement : le webhook PaiementPro, la simulation dev, et la validation manuelle admin —
 * avant cette factorisation chacun dupliquait sa propre logique de recherche/mise à jour,
 * ce qui aurait rendu très facile d'oublier l'un des trois lors du passage au multi-types.
 *
 * findTicketsByReference cherche par order_id en priorité, avec repli sur id/transaction_ref
 * pour les anciens billets créés avant l'introduction des commandes (order_id NULL).
 */
export interface ResolvedTicket {
  source: "supabase" | "local";
  raw: any;
}

export async function findTicketsByReference(candidates: Array<string | null | undefined>): Promise<ResolvedTicket[]> {
  const cleaned = Array.from(new Set(candidates.filter((c): c is string => !!c)));
  if (cleaned.length === 0) return [];

  if (isSupabaseEnabled && supabase) {
    try {
      const orClause = cleaned
        .flatMap((ref) => [`order_id.eq.${ref}`, `id.eq.${ref}`, `transaction_ref.eq.${ref}`])
        .join(",");
      const { data, error } = await supabase.from("tickets").select("*").or(orClause);
      if (!error && data && data.length > 0) {
        return data.map((raw: any) => ({ source: "supabase" as const, raw }));
      }
      if (error) {
        console.error("[Payment Reference Lookup] Erreur Supabase :", error.message);
      }
    } catch (err: any) {
      console.error("[Payment Reference Lookup] Exception Supabase :", err.message || err);
    }
  }

  const db = getDB();
  const local = (db.tickets || []).filter((t: any) =>
    cleaned.some((ref) => t.orderId === ref || t.id === ref || t.transactionRef === ref)
  );
  return local.map((raw: any) => ({ source: "local" as const, raw }));
}

// Met en forme un ticket résolu (Supabase snake_case ou local déjà camelCase) au format
// attendu par sendTicketEmail/sendPaymentFailedEmail.
export function ticketEmailShape(resolved: ResolvedTicket): any {
  const t = resolved.raw;
  if (resolved.source === "local") return { orderId: t.orderId || t.id, ...t };
  return {
    orderId: t.order_id || t.id,
    buyerEmail: t.buyer_email,
    buyerName: t.buyer_name,
    eventTitle: t.event_title,
    eventDate: t.event_date,
    eventTime: t.event_time,
    eventVenue: t.event_venue,
    tier: t.tier,
    quantity: t.quantity,
    qrCodeData: t.qr_code_data
  };
}

// Regroupe des billets individuels par commande (order_id, avec repli sur l'id du billet
// pour les anciens billets pré-migration sans order_id) pour n'envoyer qu'un seul email par
// commande au lieu d'un email par billet.
export function groupTicketsByOrder(shapedTickets: any[]): any[][] {
  const groups = new Map<string, any[]>();
  for (const t of shapedTickets) {
    const key = String(t.orderId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return Array.from(groups.values());
}

// Confirme (PENDING- -> PAID-) tous les tickets résolus qui sont encore en attente.
// Idempotent par construction : un ticket déjà confirmé (transaction_ref ne commence plus
// par "PENDING-") est silencieusement ignoré, pour ne pas renvoyer l'email de billet à
// chaque retry du webhook PaiementPro. Retourne le nombre de tickets effectivement confirmés.
export async function confirmPaymentForTickets(resolvedTickets: ResolvedTicket[]): Promise<number> {
  let confirmedCount = 0;
  // findTicketsByReference() a sa propre copie en mémoire de db.json (un getDB() distinct) :
  // on ne peut pas muter resolved.raw pour les tickets locaux et sauvegarder, ça mute un objet
  // orphelin. On recharge une copie fraîche ici et on mute CETTE copie-là, par id.
  const hasLocal = resolvedTickets.some((r) => r.source === "local");
  const db = hasLocal ? getDB() : null;
  const newlyConfirmed: any[] = [];

  for (const resolved of resolvedTickets) {
    const t = resolved.raw;
    const currentRef = String(resolved.source === "supabase" ? t.transaction_ref : t.transactionRef) || "";
    if (!currentRef.startsWith("PENDING-")) continue;
    const newRef = currentRef.replace("PENDING-", "PAID-");

    if (resolved.source === "supabase" && supabase) {
      const { error } = await supabase.from("tickets").update({ transaction_ref: newRef }).eq("id", t.id);
      if (error) {
        console.error(`[Payment Confirmation] Échec mise à jour Supabase pour id=${t.id}:`, error.message);
        continue;
      }
      t.transaction_ref = newRef;
      runInBackground(releaseWaitingRoomSlot(t.event_id, t.buyer_id));
    } else if (db) {
      const localTicket = (db.tickets || []).find((lt: any) => lt.id === t.id);
      if (!localTicket) {
        console.error(`[Payment Confirmation] Ticket local id=${t.id} introuvable lors de la sauvegarde.`);
        continue;
      }
      localTicket.transactionRef = newRef;
      runInBackground(releaseWaitingRoomSlot(localTicket.eventId, localTicket.buyerId));
    }

    newlyConfirmed.push(ticketEmailShape(resolved));
    confirmedCount++;
  }

  if (db) saveDB(db);

  // Un seul email de confirmation par commande, listant le QR code de chaque billet, plutôt
  // qu'un email par billet (cf. /api/checkout : une commande = N lignes "tickets" désormais).
  for (const group of groupTicketsByOrder(newlyConfirmed)) {
    const first = group[0];
    runInBackground(sendTicketEmail({
      buyerEmail: first.buyerEmail,
      buyerName: first.buyerName,
      eventTitle: first.eventTitle,
      eventDate: first.eventDate,
      eventTime: first.eventTime,
      eventVenue: first.eventVenue,
      tickets: group.map((t) => ({ tier: t.tier, qrCodeData: t.qrCodeData }))
    }));
  }

  return confirmedCount;
}

export async function notifyPaymentFailedForTickets(resolvedTickets: ResolvedTicket[]): Promise<void> {
  const shaped = resolvedTickets.map(ticketEmailShape);
  for (const group of groupTicketsByOrder(shaped)) {
    runInBackground(sendPaymentFailedEmail(group[0]));
  }
}

