import express from "express";
import { isSupabaseEnabled, supabase, supabaseAdmin } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { validateEvent } from "../lib/validators.js";
import { runInBackground } from "../lib/utils.js";
import { sendOrganizerEventStatusEmail } from "../lib/email.js";
import { getDefaultCommissionRate } from "../lib/commission.js";

const router = express.Router();

// API Endpoints: Event Fetching
router.get("/api/events", async (req: express.Request, res: express.Response) => {
  const { includePending } = req.query;

  // Catalogue public (sans includePending) : identique pour tout visiteur anonyme, peut
  // être mis en cache par le CDN Vercel quelques secondes pour absorber le trafic sans
  // retaper Supabase à chaque requête. La variante includePending (événements non
  // approuvés) ne doit jamais être mise en cache publiquement.
  if (!includePending) {
    res.set("Cache-Control", "public, max-age=20, stale-while-revalidate=60");
  } else {
    res.set("Cache-Control", "no-store");
  }

  if (isSupabaseEnabled && supabase) {
    try {
      let query = supabase.from("events").select("*").order("created_at", { ascending: false });
      if (!includePending) {
        query = query.eq("status", "approved");
      }
      let { data, error } = await query;

      // Handle missing 'status' column in legacy Supabase schemas gracefully
      if (error && error.message.includes('status')) {
        const fallbackQuery = await supabase.from("events").select("*").order("created_at", { ascending: false });
        if (!fallbackQuery.error) {
           data = fallbackQuery.data;
           error = null;
        } else {
           throw fallbackQuery.error;
        }
      }

      if (error) throw error;

      // Compute per-tier sold counts in one pass (avoid N+1 queries)
      const tierSoldByEvent: Record<string, Record<string, number>> = {};
      const { data: tierTickets } = await supabase
        .from("tickets")
        .select("event_id, tier")
        .not("transaction_ref", "like", "PENDING-%")
        .not("transaction_ref", "like", "FAILED-%");
      for (const t of tierTickets || []) {
        if (!tierSoldByEvent[t.event_id]) tierSoldByEvent[t.event_id] = {};
        tierSoldByEvent[t.event_id][t.tier] = (tierSoldByEvent[t.event_id][t.tier] || 0) + 1;
      }

      // Map snake_case columns back to camelCase frontend expectations
      const mappedEvents = (data || []).map((e: any) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        date: e.date,
        time: e.time,
        price: Number(e.price),
        ticketTypes: e.ticket_types,
        venue: e.venue,
        category: e.category,
        banner: e.banner,
        ticketsSold: e.tickets_sold ?? 0,
        totalTickets: e.total_tickets,
        organizerId: e.organizer_id,
        organizerName: e.organizer_name,
        status: e.status || "approved",
        waitingRoomEnabled: e.waiting_room_enabled,
        waitingRoomCapacity: e.waiting_room_capacity,
        ticketsSoldByTier: tierSoldByEvent[e.id] || {}
      }));
      return res.json(mappedEvents);
    } catch (err: any) {
      console.error("[Supabase Error] Fetching events, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  let events = db.events || [];
  if (!includePending) {
    events = events.filter((e: any) => e.status === "approved" || !e.status);
  }
  // Compute per-tier sold counts from local tickets
  const allTickets: any[] = db.tickets || [];
  const tierSoldLocal: Record<string, Record<string, number>> = {};
  for (const t of allTickets) {
    const ref = String(t.transactionRef || t.transaction_ref || "");
    if (ref.startsWith("PENDING-") || ref.startsWith("FAILED-")) continue;
    const eid = t.eventId || t.event_id;
    if (!tierSoldLocal[eid]) tierSoldLocal[eid] = {};
    const tierKey = String(t.tier || "standard").toLowerCase();
    tierSoldLocal[eid][tierKey] = (tierSoldLocal[eid][tierKey] || 0) + 1;
  }
  res.json(events.map((e: any) => ({ ...e, ticketsSoldByTier: tierSoldLocal[e.id] || {} })));
});

// Create Event Endpoint for Organizers
router.post("/api/events", requireAuth, requireRole("organizer", "admin"), validateEvent, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { title, description, date, time, price, ticketTypes, venue, category, banner, totalTickets, organizerName, waitingRoomEnabled, waitingRoomCapacity } = req.body;
  // Un organisateur ne peut créer un événement que pour lui-même ; un admin peut le créer
  // au nom d'un organisateur précis (organizerId du body), sinon pour lui-même par défaut.
  const organizerId = authUser.role === "admin" ? (req.body.organizerId || authUser.id) : authUser.id;

  if (!title || !date || !time || isNaN(price) || !venue || !category || !totalTickets || !organizerId) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires correctement." });
  }

  const newEventId = `evt-${Date.now()}`;
  const bannerUrl = banner || "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&auto=format&fit=crop&q=60";

  if (isSupabaseEnabled && supabase) {
    try {
      let insertedData;
      let { data, error } = await supabase
        .from("events")
        .insert({
          id: newEventId,
          title,
          description: description || "Aucune description fournie.",
          date,
          time,
          price: Number(price),
          ticket_types: ticketTypes,
          venue,
          category,
          banner: bannerUrl,
          tickets_sold: 0,
          total_tickets: Number(totalTickets),
          organizer_id: organizerId,
          organizer_name: organizerName || "Organisateur ClicBillet",
          status: 'pending',
          waiting_room_enabled: Boolean(waitingRoomEnabled),
          waiting_room_capacity: Number(waitingRoomCapacity) || 50
        })
        .select()
        .single();
        
      if (error && error.message.includes('status')) {
        // Fallback for legacy DB missing 'status'
        const fallback = await supabase
          .from("events")
          .insert({
            id: newEventId,
            title,
            description: description || "Aucune description fournie.",
            date,
            time,
            price: Number(price),
            ticket_types: ticketTypes,
            venue,
            category,
            banner: bannerUrl,
            tickets_sold: 0,
            total_tickets: Number(totalTickets),
            organizer_id: organizerId,
            organizer_name: organizerName || "Organisateur ClicBillet"
          })
          .select()
          .single();
          
          if (fallback.error) throw fallback.error;
          data = fallback.data;
          error = null;
      }

      if (error) throw error;

      const mappedEvent = {
        id: data.id,
        title: data.title,
        description: data.description,
        date: data.date,
        time: data.time,
        price: Number(data.price),
        ticketTypes: data.ticket_types,
        venue: data.venue,
        category: data.category,
        banner: data.banner,
        ticketsSold: data.tickets_sold,
        totalTickets: data.total_tickets,
        organizerId: data.organizer_id,
        organizerName: data.organizer_name,
        waitingRoomEnabled: data.waiting_room_enabled,
        waitingRoomCapacity: data.waiting_room_capacity
      };

      return res.status(201).json(mappedEvent);
    } catch (err: any) {
      console.error("[Supabase Error] Creating event, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const newEvent = {
    id: newEventId,
    title,
    description: description || "Aucune description fournie.",
    date,
    time,
    price: Number(price),
    ticketTypes,
    venue,
    category,
    banner: bannerUrl,
    ticketsSold: 0,
    totalTickets: Number(totalTickets),
    organizerId,
    organizerName: organizerName || "Organisateur ClicBillet"
  };

  db.events.unshift(newEvent); // put on top
  saveDB(db);

  res.status(201).json(newEvent);
});

// Update/Modify Event Endpoint
router.put("/api/events/:id", requireAuth, requireRole("organizer", "admin"), validateEvent, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { id } = req.params;
  const { title, description, date, time, price, ticketTypes, venue, category, banner, totalTickets, waitingRoomEnabled, waitingRoomCapacity } = req.body;

  if (!title || !date || !time || isNaN(price) || !venue || !category || !totalTickets) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires correctement." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: originalEvent, error: fetchErr } = await supabase
        .from("events")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr || !originalEvent) {
        return res.status(404).json({ error: "Événement introuvable." });
      }

      // L'ownership se vérifie sur l'identité authentifiée, jamais sur un organizerId
      // fourni par le client (qui pourrait sinon usurper n'importe quel organisateur).
      if (authUser.role !== "admin" && originalEvent.organizer_id !== authUser.id) {
        return res.status(403).json({ error: "Vous n'êtes pas autorisé à modifier cet événement." });
      }

      const bannerUrl = banner || originalEvent.banner;
      const { data, error } = await supabase
        .from("events")
        .update({
          title,
          description: description || "Aucune description fournie.",
          date,
          time,
          price: Number(price),
          ticket_types: ticketTypes,
          venue,
          category,
          banner: bannerUrl,
          total_tickets: Number(totalTickets),
          ...(waitingRoomEnabled !== undefined ? { waiting_room_enabled: Boolean(waitingRoomEnabled) } : {}),
          ...(waitingRoomCapacity !== undefined ? { waiting_room_capacity: Number(waitingRoomCapacity) || 50 } : {})
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Update associated tickets as well
      const { error: ticketSyncErr } = await supabase
        .from("tickets")
        .update({
          event_title: title,
          event_date: date,
          event_time: time,
          event_venue: venue
        })
        .eq("event_id", id);

      if (ticketSyncErr) {
        console.warn("Supabase Warning syncing tickets:", ticketSyncErr.message);
      }

      const mappedEvent = {
        id: data.id,
        title: data.title,
        description: data.description,
        date: data.date,
        time: data.time,
        price: Number(data.price),
        ticketTypes: data.ticket_types,
        venue: data.venue,
        category: data.category,
        banner: data.banner,
        ticketsSold: data.tickets_sold,
        totalTickets: data.total_tickets,
        organizerId: data.organizer_id,
        organizerName: data.organizer_name,
        waitingRoomEnabled: data.waiting_room_enabled,
        waitingRoomCapacity: data.waiting_room_capacity
      };

      return res.json({ success: true, message: "Événement modifié avec succès !", event: mappedEvent });
    } catch (err: any) {
      console.error("[Supabase Error] Event update, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const event = db.events.find(e => e.id === id);

  if (!event) {
    return res.status(404).json({ error: "Événement introuvable." });
  }

  // Security check: must belong to correct organizer unless it is admin
  if (authUser.role !== "admin" && event.organizerId !== authUser.id) {
    return res.status(403).json({ error: "Vous n'êtes pas autorisé à modifier cet événement." });
  }

  event.title = title;
  event.description = description || "Aucune description fournie.";
  event.date = date;
  event.time = time;
  event.price = Number(price);
  event.ticketTypes = ticketTypes;
  event.venue = venue;
  event.category = category;
  if (banner) {
    event.banner = banner;
  }
  event.totalTickets = Number(totalTickets);

  saveDB(db);

  // Sync event values into tickets as well if they exist
  db.tickets.forEach(t => {
    if (t.eventId === id) {
      t.eventTitle = title;
      t.eventDate = date;
      t.eventTime = time;
      t.eventVenue = venue;
    }
  });
  saveDB(db);

  res.json({ success: true, message: "Événement modifié avec succès !", event });
});

router.delete("/api/admin/events/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const adminClient = supabaseAdmin;

  if (adminClient) {
    try {
      const { error } = await adminClient
        .from("events")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return res.json({ success: true, message: "Événement de la plateforme supprimé avec succès." });
    } catch (err: any) {
      console.error("[Supabase Error] Deleting event, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const index = db.events.findIndex(e => e.id === id);
  if (index !== -1) {
    db.events.splice(index, 1);
    saveDB(db);
    return res.json({ success: true, message: "Événement de la plateforme supprimé avec succès." });
  }
  res.status(404).json({ error: "Événement introuvable." });
});


// --- Modération Events ---
router.patch("/api/admin/events/:id/status", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status || !["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Statut invalide" });

  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data: updatedEvent, error } = await adminClient.from("events").update({ status }).eq("id", id).select().maybeSingle();
      if (error) {
         if (error.message.includes('status')) {
            throw new Error('Supabase column events.status is missing. Update supabase_setup.sql');
         }
         throw error;
      }

      if (updatedEvent) {
        try {
          const { data: organizerUser } = await adminClient
            .from("users")
            .select("email")
            .eq("id", updatedEvent.organizer_id)
            .maybeSingle();
          runInBackground(sendOrganizerEventStatusEmail(organizerUser?.email, updatedEvent.organizer_name, updatedEvent.title, status));
        } catch (e: any) {
          console.warn("[Email] Notification organisateur (statut événement) échouée :", e.message);
        }
      }

      return res.json({ success: true, message: `Événement ${status}` });
    } catch(e: any) {
      console.warn("[Supabase Error] Admin event status update:", e.message);
    }
  }

  const db = getDB();
  const event = db.events.find(e => e.id === id);
  if (event) {
    event.status = status;
    saveDB(db);

    try {
      const organizerUser = db.users.find((u: any) => u.id === event.organizerId);
      runInBackground(sendOrganizerEventStatusEmail(organizerUser?.email, event.organizerName, event.title, status));
    } catch (e: any) {
      console.warn("[Email] Notification organisateur (statut événement) échouée :", e.message);
    }

    return res.json({ success: true, message: `Événement ${status}` });
  }
  res.status(404).json({ error: "Événement introuvable" });
});

// Surcharge de commission par événement (accord négocié avec un organisateur, offre
// promotionnelle). commissionRate: null réinitialise l'événement sur le taux par défaut
// de platform_config (cf. getDefaultCommissionRate).
router.patch("/api/admin/events/:id/commission", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { commissionRate } = req.body;

  if (commissionRate !== null && (typeof commissionRate !== "number" || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1)) {
    return res.status(400).json({ error: "Taux de commission invalide (attendu : nombre entre 0 et 1, ou null pour réinitialiser)." });
  }

  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { error } = await adminClient.from("events").update({ commission_rate: commissionRate }).eq("id", id);
      if (error) throw error;
      return res.json({ success: true, message: "Taux de commission mis à jour." });
    } catch (err: any) {
      console.warn("[Supabase Error] Admin event commission update:", err.message);
    }
  }

  const db = getDB();
  const event = db.events.find((e: any) => e.id === id) as any;
  if (!event) return res.status(404).json({ error: "Événement introuvable." });
  event.commissionRate = commissionRate;
  saveDB(db);
  res.json({ success: true, message: "Taux de commission mis à jour." });
});

// Taux de commission par défaut de la plateforme (platform_config), utilisé pour tout
// événement sans surcharge individuelle (cf. route ci-dessus).
router.get("/api/admin/commission-config", async (req: express.Request, res: express.Response) => {
  const defaultRate = await getDefaultCommissionRate();
  res.json({ defaultCommissionRate: defaultRate });
});

router.put("/api/admin/commission-config", async (req: express.Request, res: express.Response) => {
  const { defaultCommissionRate } = req.body;
  if (typeof defaultCommissionRate !== "number" || !Number.isFinite(defaultCommissionRate) || defaultCommissionRate < 0 || defaultCommissionRate > 1) {
    return res.status(400).json({ error: "Taux de commission invalide (attendu : nombre entre 0 et 1)." });
  }

  if (!supabase) {
    return res.status(400).json({ error: "Supabase non configuré : le taux par défaut reste celui codé en dur côté serveur." });
  }

  const { error } = await supabase
    .from("platform_config")
    .upsert({ key: "ticket_commission_rate", value: String(defaultCommissionRate), updated_at: new Date().toISOString() });

  if (error) {
    return res.status(500).json({ error: "Échec de la mise à jour du taux de commission par défaut." });
  }

  res.json({ success: true, defaultCommissionRate });
});

export default router;

