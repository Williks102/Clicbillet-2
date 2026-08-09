// Billets vus depuis l'espace acheteur : les consulter et les céder.
//
// Ce fichier portait auparavant l'intégralité du cycle de vie d'un billet — achat, paiement,
// expiration, scan — soit 1 236 lignes pour quatre sujets sans rapport entre eux. Chacun vit
// désormais dans son propre fichier (checkout, payments, scan, maintenance), monté au même
// endroit dans server.ts.
import crypto from "crypto";
import express from "express";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { validateTransferTicket } from "../lib/validators.js";
import { runInBackground, hasEventStarted, isQrUnlocked, getQrUnlockTime, generateTicketQrCode } from "../lib/utils.js";
import { sendTicketTransferredEmail, sendTicketTransferConfirmationEmail } from "../lib/email.js";
import { transferTicketRateLimiter } from "../lib/rateLimiters.js";

const router = express.Router();

// Fetch User Purchased Tickets Endpoint
router.get("/api/my-tickets", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const buyerId = authUser?.id;

  if (!buyerId) {
    return res.status(500).json({ error: "Impossible de récupérer l'identité de l'utilisateur." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("buyer_id", buyerId)
        .order("purchase_date", { ascending: false });

      if (error) throw error;

      const mappedTickets = (data || []).map((t: any) => {
        const unlocked = isQrUnlocked({ date: t.event_date, time: t.event_time });
        return {
          id: t.id,
          eventId: t.event_id,
          eventTitle: t.event_title,
          eventDate: t.event_date,
          eventTime: t.event_time,
          eventVenue: t.event_venue,
          buyerId: t.buyer_id,
          buyerName: t.buyer_name,
          buyerEmail: t.buyer_email,
          tier: t.tier,
          pricePaid: Number(t.price_paid),
          qrCodeData: unlocked ? t.qr_code_data : null,
          qrUnlocksAt: unlocked ? null : getQrUnlockTime({ date: t.event_date, time: t.event_time }).toISOString(),
          scanned: t.scanned,
          scannedAt: t.scanned_at,
          transactionRef: t.transaction_ref,
          purchaseDate: t.purchase_date,
          quantity: t.quantity,
          paymentStatus: t.transaction_ref?.startsWith("PENDING-") ? "pending" : "paid"
        };
      });
      return res.json(mappedTickets);
    } catch (err: any) {
      console.error("[Supabase Error] Fetching my tickets, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const filtered = db.tickets.filter((t: any) => t.buyerId === buyerId).map((t: any) => {
    const unlocked = isQrUnlocked({ date: t.eventDate, time: t.eventTime });
    return {
      ...t,
      qrCodeData: unlocked ? t.qrCodeData : null,
      qrUnlocksAt: unlocked ? null : getQrUnlockTime({ date: t.eventDate, time: t.eventTime }).toISOString(),
      paymentStatus: t.transactionRef?.startsWith("PENDING-") ? "pending" : "paid"
    };
  });
  res.json(filtered);
});

// Transfert officiel d'un billet (espace client) : décourage le partage manuel de captures
// d'écran en offrant un moyen légitime de céder un billet. L'ancien QR devient immédiatement
// inopérant (nouvelle valeur générée, cf. generateTicketQrCode) puisque /api/verify-ticket
// compare désormais la chaîne scannée à la valeur ACTUELLEMENT stockée, pas à un id qu'on
// pourrait reconstruire à partir de l'ancien code.
router.post("/api/tickets/:id/transfer", transferTicketRateLimiter, requireAuth, validateTransferTicket, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const ticketId = req.params.id;
  const { recipientName } = req.body as { recipientName?: string };
  const recipientEmail = String(req.body.recipientEmail).toLowerCase();

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: ticket, error } = await supabase.from("tickets").select("*").eq("id", ticketId).maybeSingle();
      if (error || !ticket) {
        return res.status(404).json({ error: "Billet introuvable." });
      }
      if (ticket.buyer_id !== authUser.id) {
        return res.status(403).json({ error: "Ce billet ne vous appartient pas." });
      }
      if (ticket.buyer_email?.toLowerCase() === recipientEmail) {
        return res.status(400).json({ error: "Ce billet vous appartient déjà." });
      }
      if (ticket.scanned) {
        return res.status(400).json({ error: "Ce billet a déjà été scanné à l'entrée, il ne peut plus être transféré." });
      }
      const ref = String(ticket.transaction_ref || "");
      if (ref.startsWith("PENDING-") || ref.startsWith("FAILED-") || ref.startsWith("EXPIRED-")) {
        return res.status(400).json({ error: "Ce billet n'est pas payé, il ne peut pas être transféré." });
      }
      if (hasEventStarted({ date: ticket.event_date, time: ticket.event_time })) {
        return res.status(400).json({ error: "Cet événement a déjà commencé, le billet n'est plus transférable." });
      }

      const { data: existingAccount } = await supabase.from("users").select("id, name").eq("email", recipientEmail).maybeSingle();
      const newBuyerId = existingAccount?.id || `guest-${crypto.randomUUID()}`;
      const newBuyerName = existingAccount?.name || recipientName || recipientEmail.split("@")[0];
      const newQrCodeData = generateTicketQrCode(ticketId);

      const { error: updateError } = await supabase
        .from("tickets")
        .update({ buyer_id: newBuyerId, buyer_name: newBuyerName, buyer_email: recipientEmail, qr_code_data: newQrCodeData })
        .eq("id", ticketId);
      if (updateError) throw updateError;

      // Historique en lecture seule ("Billets transférés" / "Mes billets reçus") : best-effort,
      // un échec ici ne doit jamais annuler le transfert déjà appliqué ci-dessus.
      try {
        await supabase.from("ticket_transfers").insert({
          id: `trf-${crypto.randomUUID()}`,
          ticket_id: ticketId,
          event_title: ticket.event_title,
          event_date: ticket.event_date,
          event_time: ticket.event_time,
          event_venue: ticket.event_venue,
          tier: ticket.tier,
          price_paid: ticket.price_paid,
          from_user_id: authUser.id,
          from_name: ticket.buyer_name,
          from_email: ticket.buyer_email,
          to_name: newBuyerName,
          to_email: recipientEmail,
          transferred_at: new Date().toISOString()
        });
      } catch (logErr: any) {
        console.warn("[Ticket Transfer] Échec de journalisation de l'historique:", logErr.message);
      }

      runInBackground(sendTicketTransferredEmail({
        recipientEmail,
        recipientName: newBuyerName,
        senderName: ticket.buyer_name,
        eventTitle: ticket.event_title,
        eventDate: ticket.event_date,
        eventTime: ticket.event_time,
        eventVenue: ticket.event_venue,
        tier: ticket.tier,
        qrCodeData: newQrCodeData
      }));
      runInBackground(sendTicketTransferConfirmationEmail({
        senderEmail: ticket.buyer_email,
        senderName: ticket.buyer_name,
        recipientEmail,
        eventTitle: ticket.event_title
      }));

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[Supabase Error] Transfert de billet, tentative sur db.json:", err.message);
    }
  }

  const db = getDB();
  const ticket = db.tickets.find((t: any) => t.id === ticketId) as any;
  if (!ticket) {
    return res.status(404).json({ error: "Billet introuvable." });
  }
  if (ticket.buyerId !== authUser.id) {
    return res.status(403).json({ error: "Ce billet ne vous appartient pas." });
  }
  if (ticket.buyerEmail?.toLowerCase() === recipientEmail) {
    return res.status(400).json({ error: "Ce billet vous appartient déjà." });
  }
  if (ticket.scanned) {
    return res.status(400).json({ error: "Ce billet a déjà été scanné à l'entrée, il ne peut plus être transféré." });
  }
  const ref = String(ticket.transactionRef || "");
  if (ref.startsWith("PENDING-") || ref.startsWith("FAILED-") || ref.startsWith("EXPIRED-")) {
    return res.status(400).json({ error: "Ce billet n'est pas payé, il ne peut pas être transféré." });
  }
  if (hasEventStarted({ date: ticket.eventDate, time: ticket.eventTime })) {
    return res.status(400).json({ error: "Cet événement a déjà commencé, le billet n'est plus transférable." });
  }

  const existingAccount = db.users.find((u: any) => u.email.toLowerCase() === recipientEmail);
  const newBuyerId = existingAccount?.id || `guest-${crypto.randomUUID()}`;
  const newBuyerName = existingAccount?.name || recipientName || recipientEmail.split("@")[0];
  const newQrCodeData = generateTicketQrCode(ticketId);

  const originalBuyerEmail = ticket.buyerEmail;
  const originalBuyerName = ticket.buyerName;

  ticket.buyerId = newBuyerId;
  ticket.buyerName = newBuyerName;
  ticket.buyerEmail = recipientEmail;
  ticket.qrCodeData = newQrCodeData;

  db.transfers = db.transfers || [];
  db.transfers.push({
    id: `trf-${crypto.randomUUID()}`,
    ticketId,
    eventTitle: ticket.eventTitle,
    eventDate: ticket.eventDate,
    eventTime: ticket.eventTime,
    eventVenue: ticket.eventVenue,
    tier: ticket.tier,
    pricePaid: ticket.pricePaid,
    fromUserId: authUser.id,
    fromName: originalBuyerName,
    fromEmail: originalBuyerEmail,
    toName: newBuyerName,
    toEmail: recipientEmail,
    transferredAt: new Date().toISOString()
  });
  saveDB(db);

  runInBackground(sendTicketTransferredEmail({
    recipientEmail,
    recipientName: newBuyerName,
    senderName: originalBuyerName,
    eventTitle: ticket.eventTitle,
    eventDate: ticket.eventDate,
    eventTime: ticket.eventTime,
    eventVenue: ticket.eventVenue,
    tier: ticket.tier,
    qrCodeData: newQrCodeData
  }));
  runInBackground(sendTicketTransferConfirmationEmail({
    senderEmail: originalBuyerEmail,
    senderName: originalBuyerName,
    recipientEmail,
    eventTitle: ticket.eventTitle
  }));

  res.json({ success: true });
});

// Historique en lecture seule des transferts de billets : "sent" = billets donnés (from_user_id
// = ce compte), "received" = billets reçus (to_email = l'email de ce compte — comparé par email,
// pas par id, pour couvrir aussi les transferts reçus avant même la création du compte).
router.get("/api/my-transfers", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const email = authUser.email?.toLowerCase();

  if (isSupabaseEnabled && supabase) {
    try {
      const [sentRes, receivedRes] = await Promise.all([
        supabase.from("ticket_transfers").select("*").eq("from_user_id", authUser.id).order("transferred_at", { ascending: false }),
        supabase.from("ticket_transfers").select("*").ilike("to_email", email).order("transferred_at", { ascending: false })
      ]);
      if (sentRes.error) throw sentRes.error;
      if (receivedRes.error) throw receivedRes.error;

      const mapRow = (r: any) => ({
        id: r.id,
        ticketId: r.ticket_id,
        eventTitle: r.event_title,
        eventDate: r.event_date,
        eventTime: r.event_time,
        eventVenue: r.event_venue,
        tier: r.tier,
        pricePaid: Number(r.price_paid),
        fromName: r.from_name,
        fromEmail: r.from_email,
        toName: r.to_name,
        toEmail: r.to_email,
        transferredAt: r.transferred_at
      });

      return res.json({ sent: (sentRes.data || []).map(mapRow), received: (receivedRes.data || []).map(mapRow) });
    } catch (err: any) {
      console.error("[Supabase Error] Fetching my transfers, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const transfers = db.transfers || [];
  const sent = transfers.filter((t: any) => t.fromUserId === authUser.id);
  const received = transfers.filter((t: any) => t.toEmail?.toLowerCase() === email);
  res.json({ sent, received });
});

export default router;
