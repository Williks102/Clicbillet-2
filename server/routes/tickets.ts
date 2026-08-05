import crypto from "crypto";
import express from "express";
import { isSupabaseEnabled, supabase, isProduction } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth, requireRole, optionalAuth } from "../lib/auth.js";
import { validateCheckout, validateVerifyTicket, validateTransferTicket } from "../lib/validators.js";
import { runInBackground, isEventPast, hasEventStarted, isQrUnlocked, getQrUnlockTime, generateTicketQrCode, getScanWindow, getScanWindowState, EventSchedule } from "../lib/utils.js";
import { sendOrganizerSaleEmail, sendTicketEmail, sendReservationExpiredEmail, sendTicketTransferredEmail, sendTicketTransferConfirmationEmail } from "../lib/email.js";
import { verifyPaystackSignature } from "../lib/security.js";
import { checkoutRateLimiter, transferTicketRateLimiter } from "../lib/rateLimiters.js";
import { getWaitingRoomEventConfig, advanceAndGetWaitingRoomStatus, releaseWaitingRoomSlot } from "../lib/waitingRoom.js";
import { normalizeReferenceIdentifier, findTicketsByReference, confirmPaymentForTickets, notifyPaymentFailedForTickets, ticketEmailShape, groupTicketsByOrder } from "../lib/paymentConfirmation.js";
import { PAYSTACK_SECRET_KEY, PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL, CRON_SECRET, PENDING_TICKET_EXPIRY_MINUTES, ABANDONED_TICKET_RETENTION_DAYS } from "../lib/config.js";

const router = express.Router();
const PAYSTACK_API_BASE = "https://api.paystack.co";

// Relaie tel quel (corps brut + signature d'origine) un événement Paystack qui n'appartient
// pas à ClicBillet vers l'application qui partage le même compte marchand — la signature
// HMAC-SHA512 reste valide côté destinataire puisqu'elle porte sur ce même corps brut avec la
// même clé secrète Paystack, donc son propre vérificateur de webhook fonctionne sans changement.
async function relayForeignPaystackEvent(req: express.Request): Promise<boolean> {
  if (!PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL) {
    console.warn("[Paystack Webhook] Événement d'une autre application reçu mais PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL non configuré — ignoré.");
    return false;
  }
  try {
    const signature = req.headers["x-paystack-signature"];
    const relayRes = await fetch(PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "x-paystack-signature": String(signature) } : {})
      },
      body: (req as any).rawBody ?? JSON.stringify(req.body || {})
    });
    return relayRes.ok;
  } catch (err: any) {
    console.error("[Paystack Webhook] Échec du relais vers l'autre application:", err.message);
    return false;
  }
}

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

router.post("/api/waiting-room/join", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const eventId = req.body?.eventId;
  if (!eventId) {
    return res.status(400).json({ error: "eventId requis." });
  }

  const config = await getWaitingRoomEventConfig(eventId);
  if (!config || !config.enabled) {
    // Pas de salle d'attente sur cet événement : accès direct au checkout.
    return res.json({ status: "active", position: 0 });
  }
  if (!supabase) {
    return res.status(503).json({ error: "Salle d'attente indisponible." });
  }

  const { data: existing } = await supabase
    .from("waiting_room_entries")
    .select("status")
    .eq("event_id", eventId)
    .eq("user_id", authUser.id)
    .maybeSingle();

  if (!existing) {
    const { error: insertError } = await supabase.from("waiting_room_entries").insert({
      id: `wr-${eventId}-${authUser.id}`,
      event_id: eventId,
      user_id: authUser.id,
      status: "waiting"
    });
    if (insertError) {
      console.warn("[Waiting Room] Erreur insertion entrée:", insertError.message);
    }
  } else if (existing.status === "expired") {
    // Son créneau précédent a expiré sans achat finalisé : on le remet en file, à la fin.
    await supabase.from("waiting_room_entries").update({
      status: "waiting",
      joined_at: new Date().toISOString(),
      active_until: null
    }).eq("event_id", eventId).eq("user_id", authUser.id);
  }

  const status = await advanceAndGetWaitingRoomStatus(eventId, authUser.id, config);
  if (!status) {
    return res.status(500).json({ error: "Impossible de rejoindre la salle d'attente." });
  }
  res.json(status);
});

router.get("/api/waiting-room/status", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const eventId = String(req.query.eventId || "");
  if (!eventId) {
    return res.status(400).json({ error: "eventId requis." });
  }

  const config = await getWaitingRoomEventConfig(eventId);
  if (!config || !config.enabled) {
    return res.json({ status: "active", position: 0 });
  }

  const status = await advanceAndGetWaitingRoomStatus(eventId, authUser.id, config);
  if (!status) {
    return res.status(404).json({ error: "Aucune entrée de salle d'attente trouvée. Rejoignez-la d'abord." });
  }
  res.json(status);
});

// Checkout Purchase Ticket Endpoint
const GATEWAY_SHORT_NAMES: Record<string, string> = {
  orange_money: "OM",
  mtn_momo: "MTN",
  moov_money: "MOOV",
  wave: "WAVE",
  card: "CARD"
};


router.post("/api/checkout", checkoutRateLimiter, optionalAuth, validateCheckout, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { eventId, buyerName, buyerEmail: bodyEmail, guestPhone, items, paymentDetails } = req.body as {
    eventId: string;
    buyerName: string;
    buyerEmail: string;
    guestPhone?: string;
    items: Array<{ tier: string; quantity: number }>;
    paymentDetails: { method: string };
  };
  // Pour un utilisateur connecté, l'identité vient du token (non falsifiable).
  // Pour un invité (pas de token), on utilise les données du body après validation.
  const buyerId: string = authUser?.id ?? `guest-${crypto.randomUUID()}`;
  const buyerEmail: string = authUser?.email ?? bodyEmail;

  if (!eventId || !buyerId || !buyerName || !buyerEmail || !items || !paymentDetails) {
    return res.status(400).json({ error: "Informations de commande incomplètes." });
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  // Référence de COMMANDE utilisée comme "reference" Paystack (webhook + vérification) — une
  // commande (ORD-) peut regrouper plusieurs lignes "tickets" (TKT-), une par type de billet choisi.
  const orderId = `ORD-${crypto.randomUUID()}`;
  const code = GATEWAY_SHORT_NAMES[paymentDetails.method] || "PAY";

  if (isSupabaseEnabled && supabase) {
    try {
      // 1. Fetch Event first to check tickets_sold and total_tickets
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

      if (eventError || !event) {
        return res.status(404).json({ error: "Événement introuvable." });
      }

      if (isEventPast({ date: event.date, time: event.time, endDate: event.end_date, endTime: event.end_time })) {
        return res.status(400).json({ error: "Cet événement est terminé, l'achat de billets n'est plus possible." });
      }

      // Si la salle d'attente est activée sur cet événement, l'acheteur doit avoir une
      // entrée "active" non expirée (obtenue via /api/waiting-room/join puis /status) avant
      // de pouvoir passer commande.
      if (event.waiting_room_enabled) {
        const { data: wrEntry } = await supabase
          .from("waiting_room_entries")
          .select("status, active_until")
          .eq("event_id", eventId)
          .eq("user_id", buyerId)
          .maybeSingle();

        const isActive = wrEntry?.status === "active" && wrEntry.active_until && new Date(wrEntry.active_until) > new Date();
        if (!isActive) {
          return res.status(403).json({ error: "Veuillez passer par la salle d'attente avant d'acheter ce billet." });
        }
      }

      const ticketsSold = Number(event.tickets_sold || 0);
      const totalTickets = Number(event.total_tickets || 0);

      // Réservation atomique de la capacité globale : le UPDATE ne s'applique que si la
      // capacité est encore suffisante AU MOMENT de l'écriture (condition dans le WHERE,
      // évaluée par Postgres sur la même ligne que l'incrément). Deux requêtes concurrentes
      // sur le même événement ne peuvent plus toutes les deux passer un contrôle basé sur une
      // lecture initiale devenue périmée — contrairement à un simple update({tickets_sold: x})
      // après un select séparé, qui perdrait silencieusement l'une des deux incrémentations.
      const { data: reservedEvent, error: reserveError } = await supabase
        .from("events")
        .update({ tickets_sold: ticketsSold + totalQuantity })
        .eq("id", eventId)
        .lte("tickets_sold", totalTickets - totalQuantity)
        .select("tickets_sold")
        .maybeSingle();

      if (reserveError) throw reserveError;
      if (!reservedEvent) {
        return res.status(409).json({ error: "Désolé, il n'y a plus assez de places disponibles." });
      }

      const ticketTypes = event.ticket_types || [];

      // Contrôle par palier (tier) : une seule requête groupée au lieu d'une requête par
      // palier commandé (évite le N+1). Reste du "best effort" (pas atomique comme la
      // réservation globale ci-dessus, faute d'un compteur par palier en base) : en cas de
      // dépassement détecté ici, on annule la réservation globale déjà posée juste au-dessus.
      const tierDefsByName: Record<string, any> = {};
      for (const item of items) {
        const tierDef = ticketTypes.find((t: any) => typeof t.name === "string" && t.name.toLowerCase() === item.tier);
        if (tierDef && Number(tierDef.total) > 0) tierDefsByName[item.tier] = tierDef;
      }
      if (Object.keys(tierDefsByName).length > 0) {
        const { data: tierRows } = await supabase
          .from("tickets")
          .select("tier")
          .eq("event_id", eventId)
          .in("tier", Object.keys(tierDefsByName))
          .not("transaction_ref", "like", "PENDING-%")
          .not("transaction_ref", "like", "FAILED-%");

        const soldByTier: Record<string, number> = {};
        for (const row of tierRows || []) {
          soldByTier[row.tier] = (soldByTier[row.tier] || 0) + 1;
        }

        for (const item of items) {
          const tierDef = tierDefsByName[item.tier];
          if (tierDef && (soldByTier[item.tier] || 0) + item.quantity > Number(tierDef.total)) {
            // Rembourse la réservation globale posée plus haut avant de rejeter la commande.
            await supabase.from("events").update({ tickets_sold: ticketsSold }).eq("id", eventId);
            return res.status(400).json({ error: `Il n'y a plus assez de places disponibles pour la catégorie "${tierDef.name}".` });
          }
        }
      }
      let totalPrice = 0;
      // Une ligne "tickets" = un QR code = une personne : on crée item.quantity lignes par
      // type de billet (pas une seule ligne avec quantity=N), sinon un seul scan à l'entrée
      // "consommerait" toutes les places du groupe d'un coup.
      const ticketRows: any[] = [];
      let unitIdx = 0;
      for (const item of items) {
        const selectedTier = ticketTypes.find((t: any) => typeof t.name === "string" && t.name.toLowerCase() === item.tier);
        const unitPrice = selectedTier ? Number(selectedTier.price) : Number(event.price);
        totalPrice += unitPrice * item.quantity;
        for (let u = 0; u < item.quantity; u++) {
          const ticketId = `tkt-${crypto.randomUUID()}`;
          ticketRows.push({
            id: ticketId,
            order_id: orderId,
            event_id: eventId,
            event_title: event.title,
            event_date: event.date,
            event_time: event.time,
            event_venue: event.venue,
            buyer_id: buyerId,
            buyer_name: buyerName,
            buyer_email: buyerEmail,
            tier: item.tier,
            price_paid: unitPrice,
            qr_code_data: generateTicketQrCode(ticketId),
            scanned: false,
            scanned_at: null,
            transaction_ref: `PENDING-TX-${code}-${Math.floor(1000000 + Math.random() * 9000000)}-${unitIdx}`,
            quantity: 1
          });
          unitIdx++;
        }
      }

      // Log transaction attempt (un seul mouvement, pour le montant total de la commande)
      const txStatus = totalPrice === 0 ? "completed" : "pending";
      try {
        await supabase.from("transactions").insert({
          id: orderId,
          event_id: eventId,
          buyer_email: buyerEmail,
          amount: totalPrice,
          status: txStatus,
          date: new Date().toISOString(),
          method: paymentDetails.method
        });
      } catch (e: any) { console.warn("Supabase tx log error:", e.message); }

      // Pour les billets gratuits, on confirme immédiatement (FREE- au lieu de PENDING-)
      // afin d'éviter d'attendre un webhook Paystack qui ne viendra jamais.
      if (totalPrice === 0) {
        ticketRows.forEach((t) => {
          t.transaction_ref = t.transaction_ref.replace("PENDING-", "FREE-");
        });
      }

      // 2. Insert Tickets (une ligne par billet unitaire). La réservation d'inventaire
      // (tickets_sold) a déjà été posée atomiquement plus haut, avant ce point — si
      // l'insertion échoue, on la rembourse pour ne pas bloquer des places pour rien.
      const { data: newTkts, error: tktError } = await supabase
        .from("tickets")
        .insert(ticketRows)
        .select();

      if (tktError) {
        await supabase.from("events").update({ tickets_sold: ticketsSold }).eq("id", eventId);
        throw tktError;
      }

      const mappedTickets = (newTkts || []).map((newTkt: any) => ({
        id: newTkt.id,
        orderId: newTkt.order_id,
        eventId: newTkt.event_id,
        eventTitle: newTkt.event_title,
        eventDate: newTkt.event_date,
        eventTime: newTkt.event_time,
        eventVenue: newTkt.event_venue,
        buyerId: newTkt.buyer_id,
        buyerName: newTkt.buyer_name,
        buyerEmail: newTkt.buyer_email,
        tier: newTkt.tier,
        pricePaid: Number(newTkt.price_paid),
        qrCodeData: newTkt.qr_code_data,
        scanned: newTkt.scanned,
        scannedAt: newTkt.scanned_at,
        transactionRef: newTkt.transaction_ref,
        purchaseDate: newTkt.purchase_date,
        quantity: newTkt.quantity
      }));

      // Notification organisateur (best-effort, ne doit jamais bloquer la réponse)
      try {
        const { data: organizerUser } = await supabase
          .from("users")
          .select("email")
          .eq("id", event.organizer_id)
          .maybeSingle();
        runInBackground(sendOrganizerSaleEmail(organizerUser?.email, event.organizer_name, event.title, {
          buyerName,
          quantity: totalQuantity,
          pricePaid: totalPrice
        }));
      } catch (e: any) {
        console.warn("[Email] Notification organisateur (vente) échouée :", e.message);
      }

      // Billets gratuits : envoyer l'email de confirmation immédiatement (pas de webhook).
      // Billets payants : l'email est envoyé par /api/payment/callback après confirmation.
      if (totalPrice === 0) {
        runInBackground(sendTicketEmail({
          buyerEmail,
          buyerName,
          eventTitle: event.title,
          eventDate: event.date,
          eventTime: event.time,
          eventVenue: event.venue,
          tickets: mappedTickets.map((t: any) => ({ tier: t.tier, qrCodeData: t.qrCodeData }))
        }));
      }

      return res.status(201).json({
        success: true,
        message: totalPrice === 0
          ? "Inscription gratuite confirmée ! Votre billet vous a été envoyé par email."
          : "Achat de billets effectué avec succès !",
        orderId,
        tickets: mappedTickets
      });
    } catch (err: any) {
      console.error(`[Supabase Error] Checkout (orderId=${orderId}, eventId=${eventId}):`, err.message);
      if (isProduction) {
        // Ne jamais retomber sur db.json (fichier local éphémère, non répliqué) en
        // production : un paiement "confirmé" au client qui ne serait écrit que là
        // disparaîtrait au prochain redémarrage/redéploiement, sans aucune trace.
        return res.status(503).json({ error: "Service de paiement temporairement indisponible. Veuillez réessayer." });
      }
    }
  }

  const db = getDB();
  const event = db.events.find((e: any) => e.id === eventId);

  if (!event) {
    return res.status(404).json({ error: "Événement introuvable." });
  }

  if (isEventPast({ date: event.date, time: event.time, endDate: event.endDate, endTime: event.endTime })) {
    return res.status(400).json({ error: "Cet événement est terminé, l'achat de billets n'est plus possible." });
  }

  if (event.ticketsSold + totalQuantity > event.totalTickets) {
    return res.status(400).json({ error: "Désolé, il n'y a plus assez de places disponibles." });
  }

  const ticketTypes = event.ticketTypes || [];
  let totalPrice = 0;
  // Même logique que la branche Supabase ci-dessus : une ligne par billet unitaire, pas
  // par type de billet.
  const newTickets: any[] = [];
  let unitIdx = 0;
  for (const item of items) {
    const selectedTier = ticketTypes.find((t: any) => typeof t.name === "string" && t.name.toLowerCase() === item.tier);
    const unitPrice = selectedTier ? Number(selectedTier.price) : Number(event.price);
    totalPrice += unitPrice * item.quantity;
    for (let u = 0; u < item.quantity; u++) {
      const ticketId = `tkt-${crypto.randomUUID()}`;
      newTickets.push({
        id: ticketId,
        orderId,
        eventId: event.id,
        eventTitle: event.title,
        eventDate: event.date,
        eventTime: event.time,
        eventVenue: event.venue,
        buyerId,
        buyerName,
        buyerEmail,
        tier: item.tier,
        pricePaid: unitPrice,
        qrCodeData: generateTicketQrCode(ticketId),
        scanned: false,
        scannedAt: null,
        transactionRef: `PENDING-TX-${code}-${Math.floor(1000000 + Math.random() * 9000000)}-${unitIdx}`,
        purchaseDate: new Date().toISOString(),
        quantity: 1
      });
      unitIdx++;
    }
  }

  // Pour les billets gratuits, confirmer immédiatement (FREE- au lieu de PENDING-)
  if (totalPrice === 0) {
    newTickets.forEach((t) => {
      t.transactionRef = t.transactionRef.replace("PENDING-", "FREE-");
    });
  }

  db.transactions = db.transactions || [];
  db.transactions.unshift({
    id: orderId,
    eventId: eventId,
    buyerEmail: buyerEmail,
    amount: totalPrice,
    status: totalPrice === 0 ? "completed" : "pending",
    date: new Date().toISOString(),
    method: paymentDetails.method
  } as any);

  // Update Inventory in database
  event.ticketsSold += totalQuantity;

  // Record Tickets
  db.tickets.unshift(...newTickets);
  saveDB(db);

  // Notification organisateur (best-effort, ne doit jamais bloquer la réponse)
  try {
    const organizerUser = db.users.find((u: any) => u.id === event.organizerId);
    runInBackground(sendOrganizerSaleEmail(organizerUser?.email, event.organizerName, event.title, {
      buyerName,
      quantity: totalQuantity,
      pricePaid: totalPrice
    }));
  } catch (e: any) {
    console.warn("[Email] Notification organisateur (vente) échouée :", e.message);
  }

  // Billets gratuits : envoyer l'email de confirmation immédiatement
  if (totalPrice === 0) {
    runInBackground(sendTicketEmail({
      buyerEmail,
      buyerName,
      eventTitle: event.title,
      eventDate: event.date,
      eventTime: event.time,
      eventVenue: event.venue,
      tickets: newTickets.map((t: any) => ({ tier: t.tier, qrCodeData: t.qrCodeData }))
    }));
  }

  res.status(201).json({
    success: true,
    message: totalPrice === 0
      ? "Inscription gratuite confirmée ! Votre billet vous a été envoyé par email."
      : "Achat de billets effectué avec succès !",
    orderId,
    tickets: newTickets
  });
});

// Webhook Paystack : appelé serveur-à-serveur (pas de préflight CORS nécessaire), l'URL est
// configurée une seule fois dans le Dashboard Paystack (Settings > API Keys & Webhooks), pas
// par requête comme l'était notificationURL sous PaiementPro. La signature x-paystack-signature
// (HMAC-SHA512 du corps brut avec la clé secrète) est une vraie barrière cryptographique —
// contrairement à PaiementPro, Paystack signe réellement chaque événement.
router.post("/api/webhooks/paystack", async (req: express.Request, res: express.Response) => {
  if (!verifyPaystackSignature(req)) {
    console.error("[Paystack Webhook] Signature invalide ou absente.");
    return res.status(401).json({ status: "error", message: "Signature invalide." });
  }

  const { event, data } = req.body || {};
  const rawReference = data?.reference ? String(data.reference) : null;

  // Un seul webhook Paystack est configurable par compte marchand (limitation Paystack) : ce
  // compte est partagé avec une autre application dont les références n'utilisent jamais notre
  // préfixe "ORD-". On relaie donc tout événement qui n'est pas le nôtre plutôt que de le
  // traiter ou de le perdre silencieusement.
  if (rawReference && !rawReference.startsWith("ORD-")) {
    const relayed = await relayForeignPaystackEvent(req);
    return res.status(relayed ? 200 : 502).json({ status: relayed ? "success" : "error" });
  }

  const reference = rawReference ? normalizeReferenceIdentifier(rawReference) : null;

  if (!reference) {
    console.warn(`[Paystack Webhook] Événement "${event}" reçu sans référence exploitable.`);
    return res.status(200).json({ status: "success" });
  }

  console.log(`[Paystack Webhook] Événement "${event}" reçu pour la référence ${reference}.`);

  const resolvedTickets = await findTicketsByReference([reference]);
  if (resolvedTickets.length === 0) {
    console.warn(`[Paystack Webhook] Aucun billet trouvé pour la référence : ${reference}`);
    return res.status(200).json({ status: "success" });
  }

  if (event === "charge.success") {
    const confirmedCount = await confirmPaymentForTickets(resolvedTickets);
    console.log(`[Paystack Webhook] ${confirmedCount}/${resolvedTickets.length} billet(s) confirmé(s) pour la référence ${reference}.`);
  } else if (event === "charge.failed") {
    await notifyPaymentFailedForTickets(resolvedTickets);
  }

  res.status(200).json({ status: "success" });
});

// Vérification instantanée côté client : appelée juste après que le popup Paystack Inline
// ait renvoyé sa callback (response.reference), pour confirmer le billet sans attendre la
// latence du webhook. Ne fait confiance à rien venant du navigateur : re-interroge l'API
// Paystack (Verify Transaction) avec la clé secrète, seule source de vérité fiable. Le webhook
// ci-dessus reste la confirmation faisant autorité si l'utilisateur ferme l'onglet avant que
// cet appel n'aboutisse — confirmPaymentForTickets est idempotent, donc les deux peuvent
// s'exécuter sans double confirmation ni double email.
router.post("/api/payment/verify", checkoutRateLimiter, async (req: express.Request, res: express.Response) => {
  const { reference: rawReference } = req.body as { reference?: string };
  const reference = normalizeReferenceIdentifier(rawReference);
  if (!reference) {
    return res.status(400).json({ error: "reference requise." });
  }
  if (!PAYSTACK_SECRET_KEY) {
    console.error("[Paystack Verify] PAYSTACK_SECRET_KEY non configuré.");
    return res.status(500).json({ error: "Vérification de paiement indisponible." });
  }

  let paystackStatus: string;
  try {
    const verifyRes = await fetch(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const body: any = await verifyRes.json();
    if (!verifyRes.ok || !body?.status) {
      console.error("[Paystack Verify] Réponse invalide de l'API Paystack:", body);
      return res.status(502).json({ error: "Impossible de vérifier la transaction auprès de Paystack." });
    }
    paystackStatus = body.data?.status;
  } catch (err: any) {
    console.error("[Paystack Verify] Erreur réseau:", err.message);
    return res.status(502).json({ error: "Erreur réseau lors de la vérification du paiement." });
  }

  const resolvedTickets = await findTicketsByReference([reference]);
  if (resolvedTickets.length === 0) {
    return res.status(404).json({ error: "Commande introuvable pour cette référence." });
  }

  if (paystackStatus === "success") {
    const confirmedCount = await confirmPaymentForTickets(resolvedTickets);
    console.log(`[Paystack Verify] ${confirmedCount}/${resolvedTickets.length} billet(s) confirmé(s) pour la référence ${reference}.`);
    return res.json({ success: true, status: "success" });
  }

  if (paystackStatus === "failed") {
    await notifyPaymentFailedForTickets(resolvedTickets);
  }

  res.json({ success: false, status: paystackStatus });
});

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

router.post("/api/dev/simulate-payment", async (req: express.Request, res: express.Response) => {
  // Garde redondante : NODE_ENV n'est jamais défini explicitement en développement local
  // (`npm run dev` ne fait que `tsx server.ts`, sans variable d'environnement), donc un
  // blocklist strict sur NODE_ENV === "development" casserait le développement local. Sur
  // Vercel en revanche, VERCEL_ENV est injecté automatiquement par la plateforme elle-même
  // ("production" / "preview" / "development") — jamais absent, jamais mal orthographié par
  // erreur humaine, contrairement à NODE_ENV. On ferme donc la route dès que VERCEL_ENV existe
  // et n'est pas "development", quelle que soit la valeur (ou l'absence) de NODE_ENV — ce qui
  // couvre le cas d'une preview/production Vercel où NODE_ENV n'aurait pas été positionné à
  // "production" comme attendu.
  const isNonDevVercelDeployment = Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== "development";
  if (isNonDevVercelDeployment || process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Route disponible uniquement en développement." });
  }

  const { referenceNumber } = req.body;
  if (!referenceNumber) {
    return res.status(400).json({ error: "referenceNumber requis pour la simulation." });
  }

  const rawReferenceNumber = normalizeReferenceIdentifier(referenceNumber);
  if (!rawReferenceNumber) {
    return res.status(400).json({ error: "Référence invalide." });
  }

  const resolvedTickets = await findTicketsByReference([rawReferenceNumber]);
  if (resolvedTickets.length > 0) {
    await confirmPaymentForTickets(resolvedTickets);
    return res.json({ success: true, message: "Simulation de paiement effectuée." });
  }

  res.status(404).json({ error: "Billet introuvable pour simulation." });
});

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

