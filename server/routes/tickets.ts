import express from "express";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth, requireRole, optionalAuth } from "../lib/auth.js";
import { validateCheckout, validateVerifyTicket } from "../lib/validators.js";
import { runInBackground, isEventPast } from "../lib/utils.js";
import { sendOrganizerSaleEmail, sendTicketEmail, sendReservationExpiredEmail } from "../lib/email.js";
import { verifyPaystackSignature } from "../lib/security.js";
import { checkoutRateLimiter } from "../lib/rateLimiters.js";
import { getWaitingRoomEventConfig, advanceAndGetWaitingRoomStatus, releaseWaitingRoomSlot } from "../lib/waitingRoom.js";
import { normalizeReferenceIdentifier, findTicketsByReference, confirmPaymentForTickets, notifyPaymentFailedForTickets, ticketEmailShape, groupTicketsByOrder } from "../lib/paymentConfirmation.js";
import { PAYSTACK_SECRET_KEY, PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL, CRON_SECRET, PENDING_TICKET_EXPIRY_MINUTES } from "../lib/config.js";

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

      const mappedTickets = (data || []).map((t: any) => ({
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
        qrCodeData: t.qr_code_data,
        scanned: t.scanned,
        scannedAt: t.scanned_at,
        transactionRef: t.transaction_ref,
        purchaseDate: t.purchase_date,
        quantity: t.quantity,
        paymentStatus: t.transaction_ref?.startsWith("PENDING-") ? "pending" : "paid"
      }));
      return res.json(mappedTickets);
    } catch (err: any) {
      console.error("[Supabase Error] Fetching my tickets, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const filtered = db.tickets.filter((t: any) => t.buyerId === buyerId).map((t: any) => ({
    ...t,
    paymentStatus: t.transactionRef?.startsWith("PENDING-") ? "pending" : "paid"
  }));
  res.json(filtered);
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
  const buyerId: string = authUser?.id ?? `guest-${Date.now()}`;
  const buyerEmail: string = authUser?.email ?? bodyEmail;

  if (!eventId || !buyerId || !buyerName || !buyerEmail || !items || !paymentDetails) {
    return res.status(400).json({ error: "Informations de commande incomplètes." });
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  // Référence de COMMANDE utilisée comme "reference" Paystack (webhook + vérification) — une
  // commande (ORD-) peut regrouper plusieurs lignes "tickets" (TKT-), une par type de billet choisi.
  const orderId = `ORD-${Date.now()}`;
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

      if (isEventPast({ date: event.date, time: event.time })) {
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

      if (ticketsSold + totalQuantity > totalTickets) {
        return res.status(400).json({ error: "Désolé, il n'y a plus assez de places disponibles." });
      }

      const ticketTypes = event.ticket_types || [];

      // Per-tier capacity check (only when tiers define a total)
      for (const item of items) {
        const tierDef = ticketTypes.find((t: any) => typeof t.name === "string" && t.name.toLowerCase() === item.tier);
        if (tierDef && Number(tierDef.total) > 0) {
          const { count: tierSoldCount } = await supabase
            .from("tickets")
            .select("id", { count: "exact", head: true })
            .eq("event_id", eventId)
            .eq("tier", item.tier)
            .not("transaction_ref", "like", "PENDING-%")
            .not("transaction_ref", "like", "FAILED-%");
          if ((tierSoldCount || 0) + item.quantity > Number(tierDef.total)) {
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
          const ticketId = `tkt-${Date.now()}-${unitIdx}`;
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
            tier: item.tier as "standard" | "vip",
            price_paid: unitPrice,
            qr_code_data: `clicbillet-verify:${ticketId}`,
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

      // 2. Insert Tickets (une ligne par billet unitaire)
      const { data: newTkts, error: tktError } = await supabase
        .from("tickets")
        .insert(ticketRows)
        .select();

      if (tktError) throw tktError;

      // 3. Update inventory
      const { error: updateError } = await supabase
        .from("events")
        .update({ tickets_sold: ticketsSold + totalQuantity })
        .eq("id", eventId);

      if (updateError) {
        console.error("Failed to update tickets_sold inventory, continuing...", updateError);
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
      console.error("[Supabase Error] Checkout, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const event = db.events.find((e: any) => e.id === eventId);

  if (!event) {
    return res.status(404).json({ error: "Événement introuvable." });
  }

  if (isEventPast({ date: event.date, time: event.time })) {
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
      const ticketId = `tkt-${Date.now()}-${unitIdx}`;
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
        tier: item.tier as "standard" | "vip",
        pricePaid: unitPrice,
        qrCodeData: `clicbillet-verify:${ticketId}`,
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
// toujours puisque tickets_sold n'est jamais décrémenté ailleurs. Appelée par Vercel Cron
// (cf. vercel.json), qui injecte automatiquement Authorization: Bearer <CRON_SECRET>.
router.get("/api/cron/expire-pending-tickets", async (req: express.Request, res: express.Response) => {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé." });
  }

  const cutoffIso = new Date(Date.now() - PENDING_TICKET_EXPIRY_MINUTES * 60 * 1000).toISOString();

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

    if (!staleTickets || staleTickets.length === 0) {
      return res.json({ expired: 0 });
    }

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

    console.log(`[Cron] ${staleTickets.length} billet(s) PENDING expiré(s) (délai ${PENDING_TICKET_EXPIRY_MINUTES} min).`);
    return res.json({ expired: staleTickets.length });
  }

  const db = getDB();
  const stale = (db.tickets || []).filter((t: any) =>
    String(t.transactionRef || "").startsWith("PENDING-") && new Date(t.purchaseDate) < new Date(cutoffIso)
  );

  if (stale.length === 0) {
    return res.json({ expired: 0 });
  }

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
  saveDB(db);

  for (const group of groupTicketsByOrder(stale)) {
    runInBackground(sendReservationExpiredEmail(group[0]));
  }

  console.log(`[Cron] ${stale.length} billet(s) PENDING expiré(s) (local, délai ${PENDING_TICKET_EXPIRY_MINUTES} min).`);
  res.json({ expired: stale.length });
});

router.post("/api/dev/simulate-payment", async (req: express.Request, res: express.Response) => {
  if (process.env.NODE_ENV === "production") {
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
router.post("/api/verify-ticket", requireAuth, requireRole("organizer", "admin"), validateVerifyTicket, async (req: express.Request, res: express.Response) => {
  const { qrCodeData, organizerId } = req.body;

  if (!qrCodeData) {
    return res.status(400).json({ error: "Code QR invalide ou manquant." });
  }

  const match = qrCodeData.match(/^clicbillet-verify:(tkt-[a-zA-Z0-9\-]+)$/);
  if (!match) {
    return res.status(400).json({ error: "Ce code QR n'est pas un billet valide ClicBillet." });
  }

  const ticketId = match[1];

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: ticket, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", ticketId)
        .maybeSingle();

      if (error || !ticket) {
        return res.status(404).json({ error: "Billet introuvable dans notre système de sécurité." });
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

      // Mark as verified
      const verifiedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("tickets")
        .update({
          scanned: true,
          scanned_at: verifiedAt
        })
        .eq("id", ticketId);

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
  const ticket = db.tickets.find((t: any) => t.id === ticketId);

  if (!ticket) {
    return res.status(404).json({ error: "Billet introuvable dans notre système de sécurité." });
  }

  // Cross-verify: Wait, is the organizer allowed to scan this? Yes, any registered organizer can inspect tickets!
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

