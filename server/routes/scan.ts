// Contrôle d'accès à l'entrée : c'est le seul point qui transforme un billet vendu en entrée
// effective. Isolé du tunnel d'achat parce qu'il s'exécute dans des conditions radicalement
// différentes — sur le téléphone d'un contrôleur, à l'entrée d'un lieu, souvent en réseau
// dégradé, et sur une rafale de scans en quelques minutes.
import express from "express";
import crypto from "crypto";
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

// ==========================================
// CONTRÔLE HORS LIGNE (cf. supabase_setup.sql section 28)
// ==========================================

// Empreinte du code QR. Le manifeste ne descend JAMAIS les codes en clair sur les appareils :
// un téléphone perdu ou volé permettrait sinon de fabriquer des billets valides. Le scanner
// hache le code présenté et cherche l'empreinte — la validation est identique, la fuite ne
// l'est pas.
function empreinte(qrCodeData: string): string {
  return crypto.createHash("sha256").update(String(qrCodeData)).digest("hex");
}

// Événements que ce compte peut contrôler, pour choisir lequel préparer. Volontairement
// minimal — id, titre, date — plutôt que de réutiliser le catalogue public et de filtrer
// côté navigateur.
router.get("/api/scan/events", requireAuth, requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  res.set("Cache-Control", "no-store");

  if (!isSupabaseEnabled || !supabase) {
    const db = getDB();
    const liste = (db.events || [])
      .filter((e: any) => authUser.role === "admin" || e.organizerId === authUser.id)
      .map((e: any) => ({ id: e.id, title: e.title, date: e.date, time: e.time }));
    return res.json(liste);
  }

  let requete = supabase.from("events").select("id, title, date, time").order("date", { ascending: true });
  if (authUser.role !== "admin") requete = requete.eq("organizer_id", authUser.id);

  const { data, error } = await requete;
  if (error) return res.status(500).json({ error: "Impossible de lister les événements." });
  res.json(data || []);
});

// Liste des billets d'un événement, à charger dans l'appareil AVANT l'ouverture des portes.
router.get("/api/scan/manifest", requireAuth, requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const eventId = String(req.query.eventId || "");
  if (!eventId) return res.status(400).json({ error: "eventId requis." });

  // Jamais de cache intermédiaire : un manifeste périmé fait refouler des acheteurs récents.
  res.set("Cache-Control", "no-store");

  if (!isSupabaseEnabled || !supabase) {
    const db = getDB();
    const evt = (db.events || []).find((e: any) => e.id === eventId);
    if (!evt) return res.status(404).json({ error: "Événement introuvable." });
    if (authUser.role !== "admin" && evt.organizerId !== authUser.id) {
      return res.status(403).json({ error: "Cet événement ne vous appartient pas." });
    }
    const billets = (db.tickets || []).filter((t: any) => t.eventId === eventId);
    return res.json(construireManifeste(evt, billets.map((t: any) => ({
      id: t.id, qr_code_data: t.qrCodeData, tier: t.tier, buyer_name: t.buyerName,
      scanned: t.scanned, transaction_ref: t.transactionRef
    }))));
  }

  const { data: evt } = await supabase
    .from("events")
    .select("id, title, organizer_id, date, time, end_date, end_time")
    .eq("id", eventId)
    .maybeSingle();

  if (!evt) return res.status(404).json({ error: "Événement introuvable." });
  if (authUser.role !== "admin" && evt.organizer_id !== authUser.id) {
    return res.status(403).json({ error: "Cet événement ne vous appartient pas." });
  }

  const { data: billets, error } = await supabase
    .from("tickets")
    .select("id, qr_code_data, tier, buyer_name, scanned, transaction_ref")
    .eq("event_id", eventId);

  if (error) return res.status(500).json({ error: "Impossible de constituer le manifeste." });

  res.json(construireManifeste({
    id: evt.id, title: evt.title, date: evt.date, time: evt.time,
    endDate: evt.end_date, endTime: evt.end_time
  }, billets || []));
});

function construireManifeste(evt: any, billets: any[]) {
  const fenetre = getScanWindow({
    date: evt.date, time: evt.time,
    endDate: evt.endDate ?? evt.end_date, endTime: evt.endTime ?? evt.end_time
  });

  return {
    eventId: evt.id,
    eventTitle: evt.title,
    generatedAt: new Date().toISOString(),
    // La fenêtre part avec le manifeste : hors ligne aussi, un billet présenté trop tôt ou
    // après la fin doit être refusé. Sans elle, le mode dégradé serait plus permissif que le
    // mode connecté — une incohérence que le contrôleur ne pourrait pas expliquer.
    scanWindow: { opensAt: fenetre.opensAt.toISOString(), closesAt: fenetre.closesAt.toISOString() },
    tickets: billets.map((t: any) => ({
      id: t.id,
      h: empreinte(t.qr_code_data),
      tier: t.tier,
      buyerName: t.buyer_name || null,
      // Les billets non payés figurent au manifeste avec leur état, plutôt que d'en être
      // absents : hors ligne, le contrôleur doit pouvoir dire « paiement non confirmé »
      // plutôt que « billet inconnu », qui enverrait la personne au mauvais interlocuteur.
      st: String(t.transaction_ref || "").startsWith("PENDING-") ? "unpaid" : (t.scanned ? "scanned" : "ok")
    }))
  };
}

// Remontée du journal local à la reconnexion.
router.post("/api/scan/sync", requireAuth, requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { deviceId, passages } = req.body || {};

  if (!Array.isArray(passages)) {
    return res.status(400).json({ error: "Journal de passages invalide." });
  }
  if (passages.length > 5000) {
    return res.status(413).json({ error: "Journal trop volumineux : synchronisez plus souvent." });
  }

  const applique: string[] = [];
  const conflits: any[] = [];

  if (!isSupabaseEnabled || !supabase) {
    const db = getDB();
    for (const p of passages) {
      const t = (db.tickets || []).find((x: any) => x.id === p.ticketId);
      if (!t) continue;
      if (t.scanned) {
        conflits.push({ ticketId: t.id, existingScannedAt: t.scannedAt, existingDevice: t.scannedDevice || null });
        continue;
      }
      t.scanned = true;
      t.scannedAt = p.at;
      t.scannedDevice = deviceId || null;
      t.scanSource = "offline";
      applique.push(t.id);
    }
    saveDB(db);
    return res.json({ applied: applique.length, conflicts: conflits });
  }

  for (const p of passages) {
    const ticketId = String(p?.ticketId || "");
    const at = String(p?.at || "");
    if (!ticketId || !at) continue;

    const { data: t } = await supabase
      .from("tickets")
      .select("id, event_id, scanned, scanned_at, scanned_device")
      .eq("id", ticketId)
      .maybeSingle();
    if (!t) continue;

    // Même contrôle de propriété qu'au scan en ligne : un organisateur ne consomme que les
    // billets de ses propres événements, y compris par cette voie.
    if (authUser.role !== "admin") {
      const { data: evt } = await supabase.from("events").select("organizer_id").eq("id", t.event_id).maybeSingle();
      if (!evt || evt.organizer_id !== authUser.id) continue;
    }

    if (t.scanned) {
      // Doublon : on l'enregistre plutôt que de l'écraser. Le premier passage fait foi — la
      // personne est déjà entrée, réécrire l'horodatage effacerait la trace de la fraude.
      conflits.push({
        ticketId: t.id,
        existingScannedAt: t.scanned_at,
        existingDevice: t.scanned_device || null,
        attemptedAt: at
      });
      await supabase.from("scan_conflicts").insert({
        id: `sc-${crypto.randomUUID()}`,
        ticket_id: t.id,
        event_id: t.event_id,
        device_id: deviceId || null,
        attempted_at: at,
        existing_device: t.scanned_device || null,
        existing_scanned_at: t.scanned_at
      });
      continue;
    }

    // La condition sur "scanned" est reportée dans le WHERE : deux appareils qui
    // synchronisent en même temps ne peuvent pas valider tous les deux le même billet en se
    // fondant sur une lecture devenue périmée.
    const { data: maj } = await supabase
      .from("tickets")
      .update({ scanned: true, scanned_at: at, scanned_device: deviceId || null, scan_source: "offline" })
      .eq("id", t.id)
      .eq("scanned", false)
      .select("id")
      .maybeSingle();

    if (maj) applique.push(t.id);
    else conflits.push({ ticketId: t.id, existingScannedAt: t.scanned_at, attemptedAt: at });
  }

  res.json({ applied: applique.length, conflicts: conflits });
});

export default router;
