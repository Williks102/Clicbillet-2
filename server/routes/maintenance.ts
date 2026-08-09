// Tâches périodiques appelées par un planificateur externe, jamais par un utilisateur.
//
// Protégées par CRON_SECRET plutôt que par une session : personne n'est connecté quand elles
// s'exécutent. Elles libèrent l'inventaire réservé par les paniers abandonnés et purgent les
// données qui n'ont plus de valeur passé leur délai de rétention.
import express from "express";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { runInBackground } from "../lib/utils.js";
import { sendReservationExpiredEmail } from "../lib/email.js";
import { releaseWaitingRoomSlot } from "../lib/waitingRoom.js";
import { groupTicketsByOrder, ticketEmailShape } from "../lib/paymentConfirmation.js";
import { CRON_SECRET, PENDING_TICKET_EXPIRY_MINUTES, ABANDONED_TICKET_RETENTION_DAYS } from "../lib/config.js";

const router = express.Router();

// Annule automatiquement les billets restés "PENDING-" (paiement jamais confirmé ni
// explicitement échoué) au-delà de PENDING_TICKET_EXPIRY_MINUTES, et libère l'inventaire
// qu'ils réservaient — sans cette expiration, un panier abandonné bloque des places pour
// toujours puisque tickets_sold n'est jamais décrémenté ailleurs. Purge aussi, à chaque
// exécution, les données qui n'ont plus aucune valeur passé leur propre délai de rétention
// (paniers abandonnés/échoués anciens, jetons de réinitialisation de mot de passe expirés) —
// jamais les billets payés ni les transactions réussies, qui restent des pièces comptables/
// justificatifs d'entrée. Appelée périodiquement par un planificateur externe (pas Vercel
// Cron, cf. .env.example) avec Authorization: Bearer <CRON_SECRET>.
router.get("/api/cron/expire-pending-tickets", async (req: express.Request, res: express.Response) => {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé." });
  }

  const cutoffIso = new Date(Date.now() - PENDING_TICKET_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const retentionCutoffIso = new Date(Date.now() - ABANDONED_TICKET_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  if (isSupabaseEnabled && supabase) {
    const { data: staleTickets, error } = await supabase
      .from("tickets")
      .select("*")
      .like("transaction_ref", "PENDING-%")
      .lt("purchase_date", cutoffIso);

    if (error) {
      console.error("[Cron] Erreur récupération billets PENDING expirés:", error.message);
      return res.status(500).json({ error: "Erreur lors de la récupération des billets expirés." });
    }

    let expiredCount = 0;
    if (staleTickets && staleTickets.length > 0) {
      // Une décrémentation par événement (pas par billet) pour limiter les allers-retours,
      // sur le même modèle que l'incrémentation faite à la création de la commande.
      const qtyByEvent: Record<string, number> = {};
      for (const t of staleTickets) {
        qtyByEvent[t.event_id] = (qtyByEvent[t.event_id] || 0) + Number(t.quantity || 1);
      }
      for (const [eventId, qty] of Object.entries(qtyByEvent)) {
        const { data: event } = await supabase.from("events").select("tickets_sold").eq("id", eventId).maybeSingle();
        if (event) {
          const newCount = Math.max(0, Number(event.tickets_sold || 0) - qty);
          await supabase.from("events").update({ tickets_sold: newCount }).eq("id", eventId);
        }
      }

      for (const t of staleTickets) {
        const newRef = String(t.transaction_ref).replace("PENDING-", "EXPIRED-");
        await supabase.from("tickets").update({ transaction_ref: newRef }).eq("id", t.id);
        runInBackground(releaseWaitingRoomSlot(t.event_id, t.buyer_id));
      }

      const shaped = staleTickets.map((t: any) => ticketEmailShape({ source: "supabase" as const, raw: t }));
      for (const group of groupTicketsByOrder(shaped)) {
        runInBackground(sendReservationExpiredEmail(group[0]));
      }

      expiredCount = staleTickets.length;
      console.log(`[Cron] ${expiredCount} billet(s) PENDING expiré(s) (délai ${PENDING_TICKET_EXPIRY_MINUTES} min).`);
    }

    // Purge de rétention : supprime définitivement les paniers abandonnés/échoués (jamais
    // payés) au-delà d'ABANDONED_TICKET_RETENTION_DAYS.
    const { count: purgedTicketsCount, error: purgeTicketsError } = await supabase
      .from("tickets")
      .delete({ count: "exact" })
      .or("transaction_ref.like.EXPIRED-%,transaction_ref.like.FAILED-%")
      .lt("purchase_date", retentionCutoffIso);
    if (purgeTicketsError) {
      console.error("[Cron] Erreur purge billets abandonnés expirés:", purgeTicketsError.message);
    }

    // Jetons de réinitialisation de mot de passe expirés : aucune valeur passé expires_at (la
    // route reset-password les rejette déjà), pure surface d'attaque/PII résiduelle.
    const { count: purgedResetsCount, error: purgeResetsError } = await supabase
      .from("password_resets")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());
    if (purgeResetsError) {
      console.error("[Cron] Erreur purge jetons de réinitialisation expirés:", purgeResetsError.message);
    }

    if ((purgedTicketsCount || 0) > 0 || (purgedResetsCount || 0) > 0) {
      console.log(`[Cron] Purge rétention : ${purgedTicketsCount || 0} billet(s) abandonné(s), ${purgedResetsCount || 0} jeton(s) de réinitialisation expiré(s).`);
    }

    return res.json({
      expired: expiredCount,
      purgedAbandonedTickets: purgedTicketsCount || 0,
      purgedExpiredResetTokens: purgedResetsCount || 0
    });
  }

  const db = getDB();
  const stale = (db.tickets || []).filter((t: any) =>
    String(t.transactionRef || "").startsWith("PENDING-") && new Date(t.purchaseDate) < new Date(cutoffIso)
  );

  let expiredCountLocal = 0;
  if (stale.length > 0) {
    const qtyByEventLocal: Record<string, number> = {};
    for (const t of stale) {
      qtyByEventLocal[t.eventId] = (qtyByEventLocal[t.eventId] || 0) + Number(t.quantity || 1);
      t.transactionRef = t.transactionRef.replace("PENDING-", "EXPIRED-");
    }
    for (const event of db.events || []) {
      if (qtyByEventLocal[event.id]) {
        event.ticketsSold = Math.max(0, event.ticketsSold - qtyByEventLocal[event.id]);
      }
    }

    for (const group of groupTicketsByOrder(stale)) {
      runInBackground(sendReservationExpiredEmail(group[0]));
    }
    expiredCountLocal = stale.length;
    console.log(`[Cron] ${expiredCountLocal} billet(s) PENDING expiré(s) (local, délai ${PENDING_TICKET_EXPIRY_MINUTES} min).`);
  }

  // Purge de rétention (mêmes règles que la branche Supabase ci-dessus).
  const beforeTicketsCount = (db.tickets || []).length;
  db.tickets = (db.tickets || []).filter((t: any) => {
    const ref = String(t.transactionRef || "");
    const isAbandoned = ref.startsWith("EXPIRED-") || ref.startsWith("FAILED-");
    return !(isAbandoned && new Date(t.purchaseDate) < new Date(retentionCutoffIso));
  });
  const purgedTicketsCountLocal = beforeTicketsCount - (db.tickets || []).length;

  const beforeResetsCount = (db.passwordResets || []).length;
  db.passwordResets = (db.passwordResets || []).filter((r: any) => new Date(r.expiresAt) > new Date());
  const purgedResetsCountLocal = beforeResetsCount - (db.passwordResets || []).length;

  saveDB(db);

  if (purgedTicketsCountLocal > 0 || purgedResetsCountLocal > 0) {
    console.log(`[Cron] Purge rétention (local) : ${purgedTicketsCountLocal} billet(s) abandonné(s), ${purgedResetsCountLocal} jeton(s) de réinitialisation expiré(s).`);
  }

  res.json({
    expired: expiredCountLocal,
    purgedAbandonedTickets: purgedTicketsCountLocal,
    purgedExpiredResetTokens: purgedResetsCountLocal
  });
});

export default router;
