// Contrôle d'accès à l'entrée : c'est le seul point qui transforme un billet vendu en entrée
// effective. Isolé du tunnel d'achat parce qu'il s'exécute dans des conditions radicalement
// différentes — sur le téléphone d'un contrôleur, à l'entrée d'un lieu, souvent en réseau
// dégradé, et sur une rafale de scans en quelques minutes.
import express from "express";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { validateVerifyTicket } from "../lib/validators.js";
import { getScanWindow, getScanWindowState, EventSchedule } from "../lib/utils.js";

const router = express.Router();

// Ticket Verification Endpoint (QR Scanning Verification)
// Message de refus quand le billet est présenté hors de la fenêtre de validité de son
// événement, ou null si le scan est autorisé. Le message distingue les deux bornes : refuser
// un billet trop tôt et refuser un billet périmé n'appellent pas la même réaction du
// contrôleur à l'entrée.
function describeScanWindowRefusal(evt: EventSchedule): string | null {
  const state = getScanWindowState(evt);
  if (state === "open") return null;

  const { opensAt, closesAt } = getScanWindow(evt);
  const format = (d: Date) => d.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

  return state === "too-early"
    ? `Trop tôt : ce billet ne sera valide qu'à partir du ${format(opensAt)}.`
    : `Événement terminé : ce billet n'est plus valide depuis le ${format(closesAt)}.`;
}

router.post("/api/verify-ticket", requireAuth, requireRole("organizer", "admin"), validateVerifyTicket, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { qrCodeData } = req.body;

  if (!qrCodeData) {
    return res.status(400).json({ error: "Code QR invalide ou manquant." });
  }

  // Recherche par correspondance EXACTE de qr_code_data (colonne UNIQUE) plutôt que d'en
  // extraire l'id du billet par regex : ce dernier était trusté aveuglément, si bien qu'un code
  // "clicbillet-verify:{id}" reconstruit à partir du seul id (visible ailleurs, ex. affichage
  // "ID: ..." de l'espace client) validait toujours, même après régénération du vrai QR (masquage
  // H-4, transfert de billet). Ici, seule la valeur actuellement stockée en base fait foi.
  if (isSupabaseEnabled && supabase) {
    try {
      const { data: ticket, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("qr_code_data", qrCodeData)
        .maybeSingle();

      if (error || !ticket) {
        return res.status(404).json({ error: "Billet introuvable dans notre système de sécurité." });
      }

      // L'événement est désormais chargé pour TOUT scan, et non plus seulement pour le
      // contrôle de propriété : sa fenêtre de validité en dépend.
      const { data: ticketEvent } = await supabase
        .from("events")
        .select("organizer_id, date, time, end_date, end_time")
        .eq("id", ticket.event_id)
        .maybeSingle();

      // Un organisateur ne doit pouvoir scanner que les billets de SES PROPRES événements —
      // sans ce contrôle, n'importe quel compte organisateur pouvait scanner/consommer les
      // billets d'un événement appartenant à un autre organisateur.
      if (authUser.role !== "admin") {
        if (!ticketEvent || ticketEvent.organizer_id !== authUser.id) {
          return res.status(403).json({ error: "Ce billet n'appartient pas à l'un de vos événements." });
        }
      }


      const mappedTicket = {
        id: ticket.id,
        eventId: ticket.event_id,
        eventTitle: ticket.event_title,
        eventDate: ticket.event_date,
        eventTime: ticket.event_time,
        eventVenue: ticket.event_venue,
        buyerId: ticket.buyer_id,
        buyerName: ticket.buyer_name,
        buyerEmail: ticket.buyer_email,
        tier: ticket.tier,
        pricePaid: Number(ticket.price_paid),
        qrCodeData: ticket.qr_code_data,
        scanned: ticket.scanned,
        scannedAt: ticket.scanned_at,
        transactionRef: ticket.transaction_ref,
        purchaseDate: ticket.purchase_date,
        quantity: ticket.quantity
      };

      if (ticket.scanned) {
        return res.status(200).json({
          success: false,
          alreadyScanned: true,
          scannedAt: ticket.scanned_at,
          ticket: mappedTicket
        });
      }

      // Un billet créé via /api/checkout reste en "PENDING-" tant que le paiement n'a
      // pas été confirmé (webhook Paystack ou validation manuelle admin). On refuse
      // le scan tant que ce n'est pas le cas, quelle que soit la fiabilité du webhook.
      if (String(ticket.transaction_ref || "").startsWith("PENDING-")) {
        return res.status(409).json({
          success: false,
          error: "Paiement non confirmé pour ce billet : entrée refusée.",
          ticket: mappedTicket
        });
      }

      // Fenêtre de validité : dernier refus avant de consommer le billet, pour que
      // "déjà utilisé" et "paiement non confirmé" — plus actionnables à l'entrée — soient
      // annoncés en priorité.
      if (ticketEvent) {
        const windowRefusal = describeScanWindowRefusal({
          date: ticketEvent.date,
          time: ticketEvent.time,
          endDate: ticketEvent.end_date,
          endTime: ticketEvent.end_time,
        });
        if (windowRefusal) {
          return res.status(409).json({ success: false, reason: "scan-window", error: windowRefusal, ticket: mappedTicket });
        }
      }

      // Mark as verified
      const verifiedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("tickets")
        .update({
          scanned: true,
          scanned_at: verifiedAt
        })
        .eq("id", ticket.id);

      if (updateError) throw updateError;

      mappedTicket.scanned = true;
      mappedTicket.scannedAt = verifiedAt;

      return res.json({
        success: true,
        alreadyScanned: false,
        ticket: mappedTicket
      });
    } catch (err: any) {
      console.error("[Supabase Error] Verification, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const ticket = db.tickets.find((t: any) => t.qrCodeData === qrCodeData);

  if (!ticket) {
    return res.status(404).json({ error: "Billet introuvable dans notre système de sécurité." });
  }

  const ticketEvent = db.events.find((e: any) => e.id === ticket.eventId) as any;

  // Un organisateur ne doit pouvoir scanner que les billets de SES PROPRES événements.
  if (authUser.role !== "admin") {
    if (!ticketEvent || ticketEvent.organizerId !== authUser.id) {
      return res.status(403).json({ error: "Ce billet n'appartient pas à l'un de vos événements." });
    }
  }


  if (ticket.scanned) {
    return res.status(200).json({
      success: false,
      alreadyScanned: true,
      scannedAt: ticket.scannedAt,
      ticket
    });
  }

  // Un billet créé via /api/checkout reste en "PENDING-" tant que le paiement n'a pas
  // été confirmé (webhook Paystack ou validation manuelle admin). On refuse le scan
  // tant que ce n'est pas le cas, quelle que soit la fiabilité du webhook.
  if (String(ticket.transactionRef || "").startsWith("PENDING-")) {
    return res.status(409).json({
      success: false,
      error: "Paiement non confirmé pour ce billet : entrée refusée.",
      ticket
    });
  }

  if (ticketEvent) {
    const windowRefusal = describeScanWindowRefusal(ticketEvent);
    if (windowRefusal) {
      return res.status(409).json({ success: false, reason: "scan-window", error: windowRefusal, ticket });
    }
  }

  // Mark as verified
  ticket.scanned = true;
  ticket.scannedAt = new Date().toISOString();
  saveDB(db);

  res.json({
    success: true,
    alreadyScanned: false,
    ticket
  });
});

export default router;
