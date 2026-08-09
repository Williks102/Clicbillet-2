// Tunnel d'achat : salle d'attente puis passage de commande.
//
// La salle d'attente vit ici plutôt que dans son propre fichier parce qu'elle n'existe que
// pour /api/checkout : c'est ce dernier qui exige une entrée "active" avant d'accepter une
// commande sur un événement à forte affluence. Les séparer obligerait à lire deux fichiers
// pour comprendre une seule règle.
//
// Le reste du cycle de vie d'un paiement (webhook Paystack, vérification, expiration des
// paniers) vit dans payments.ts et maintenance.ts : ce fichier ne couvre que le moment où
// l'acheteur passe commande.
import crypto from "crypto";
import express from "express";
import { isSupabaseEnabled, supabase, isProduction } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth, optionalAuth } from "../lib/auth.js";
import { validateCheckout } from "../lib/validators.js";
import { runInBackground, isEventPast, generateTicketQrCode } from "../lib/utils.js";
import { sendOrganizerSaleEmail, sendTicketEmail } from "../lib/email.js";
import { checkoutRateLimiter } from "../lib/rateLimiters.js";
import { evaluateWaitingRoomGate, advanceAndGetWaitingRoomStatus } from "../lib/waitingRoom.js";

const router = express.Router();

router.post("/api/waiting-room/join", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const eventId = req.body?.eventId;
  if (!eventId) {
    return res.status(400).json({ error: "eventId requis." });
  }

  // Le portillon enregistre le passage de cet acheteur ET décide. Il est appelé pour TOUS
  // les événements, y compris hors affluence : c'est ce passage qui alimente la mesure, et
  // c'est lui qui permet à la file de s'armer seule quand la ruée arrive.
  const gate = await evaluateWaitingRoomGate(eventId, authUser.id);
  if (!gate.queueActive) {
    // Trafic normal : accès direct au paiement, aucune file affichée.
    return res.json({ status: "active", position: 0 });
  }
  const config = { capacity: gate.capacity, activeMinutes: gate.activeMinutes };
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

  const gate = await evaluateWaitingRoomGate(eventId, authUser.id);
  if (!gate.queueActive) {
    return res.json({ status: "active", position: 0 });
  }

  const status = await advanceAndGetWaitingRoomStatus(eventId, authUser.id, { capacity: gate.capacity, activeMinutes: gate.activeMinutes });
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

      // Contrôle refait ici, et non d'après un drapeau porté par l'événement : la file
      // s'armant sur l'affluence mesurée, son état n'est connu qu'à l'instant présent.
      // Sans cette réévaluation, appeler /api/checkout directement contournerait la file.
      //
      // Conséquence assumée : un acheteur entré au calme mais qui met plusieurs minutes à
      // valider peut se voir renvoyé vers la file si une ruée démarre entre-temps. Le
      // navigateur l'y conduit alors normalement ; l'inverse — le laisser passer — reviendrait
      // à le faire doubler tous ceux qui patientent.
      const gateAchat = await evaluateWaitingRoomGate(eventId, buyerId);
      if (gateAchat.queueActive) {
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

      // Réservation du stock : un seul aller-retour, décidé ENTIÈREMENT en base
      // (cf. supabase_setup.sql section 25). La capacité globale ET les plafonds par
      // catégorie sont vérifiés puis avancés sous le verrou de la ligne de l'événement,
      // dans la même transaction.
      //
      // La séquence précédente — lire tickets_sold, puis écrire "valeur lue + quantité" —
      // paraissait atomique grâce à sa condition WHERE, mais la valeur ÉCRITE provenait
      // d'une lecture périmée : chaque acheteur simultané effaçait le compte des autres.
      // Une campagne de charge sur le schéma réel l'a mesuré : 200 acheteurs simultanés sur
      // 100 places obtenaient 200 billets, compteur affiché à 1. C'est le scénario même
      // d'une mise en vente très demandée — exactement quand il ne faut pas survendre.
      const { data: reservation, error: reserveError } = await supabase.rpc("reserve_tickets", {
        p_event_id: eventId,
        p_qty: totalQuantity,
        p_items: items.map((it: any) => ({ tier: it.tier, quantity: it.quantity }))
      });
      if (reserveError) throw reserveError;

      const verdict = Array.isArray(reservation) ? reservation[0] : reservation;
      if (!verdict?.ok) {
        if (verdict?.reason === "palier") {
          return res.status(400).json({ error: `Il n'y a plus assez de places disponibles pour la catégorie "${verdict.tier_label}".` });
        }
        if (verdict?.reason === "introuvable") {
          return res.status(404).json({ error: "Événement introuvable." });
        }
        return res.status(409).json({ error: "Désolé, il n'y a plus assez de places disponibles." });
      }

      // Rend les places retenues si la suite échoue : décrément relatif côté base, pour ne
      // pas écraser les ventes conclues entre-temps.
      const rendreLesPlaces = async () => {
        try {
          await supabase.rpc("release_tickets", {
            p_event_id: eventId,
            p_qty: totalQuantity,
            p_items: items.map((it: any) => ({ tier: it.tier, quantity: it.quantity }))
          });
        } catch (e: any) {
          console.error(`[Checkout] Places non rendues pour ${eventId} :`, e?.message);
        }
      };

      const ticketTypes = event.ticket_types || [];
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
        await rendreLesPlaces();
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

export default router;
