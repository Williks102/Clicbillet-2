import express from "express";
import { isSupabaseEnabled, supabase, supabaseAdmin } from "../lib/config";
import { getDB, saveDB } from "../lib/db";
import { requireAuth, requireRole } from "../lib/auth";
import { runInBackground } from "../lib/utils";
import { sendOrganizerPayoutStatusEmail } from "../lib/email";
import { getDefaultCommissionRate, computeCommissionBreakdown } from "../lib/commission";
import { findTicketsByReference, confirmPaymentForTickets } from "../lib/paymentConfirmation";

const router = express.Router();

// Admin-specific Management APIs
router.get("/api/admin/stats", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data: users, error: uErr } = await adminClient.from("users").select("*");
      const { data: events, error: eErr } = await adminClient.from("events").select("*");
      const { data: tickets, error: tErr } = await adminClient.from("tickets").select("*");

      if (uErr) throw uErr;
      if (eErr) throw eErr;
      if (tErr) throw tErr;

      const matchedTickets = tickets || [];
      const defaultCommissionRate = await getDefaultCommissionRate();
      const eventCommissionRateById = new Map((events || []).map((e: any) => [e.id, e.commission_rate != null ? Number(e.commission_rate) : null]));
      const { totalGrossRevenue: totalRevenue, totalCommission: totalPlatformCommission, effectiveCommissionRate: commissionRate } = computeCommissionBreakdown(matchedTickets, eventCommissionRateById, defaultCommissionRate);
      const totalOrganizerPayout = totalRevenue - totalPlatformCommission;

      const totalTicketsSold = matchedTickets.reduce((sum: number, t: any) => sum + Number(t.quantity || 1), 0);
      const totalUsers = (users || []).length;
      const totalEvents = (events || []).length;

      const mappedUsers = (users || []).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
      const mappedEvents = (events || []).map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        date: e.date,
        time: e.time,
        price: Number(e.price),
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
        commissionRate: e.commission_rate != null ? Number(e.commission_rate) : null
      }));
      const mappedTickets = matchedTickets.map(t => ({
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

      return res.json({
        totalRevenue,
        totalPlatformCommission,
        totalOrganizerPayout,
        commissionRate,
        totalTicketsSold,
        totalUsers,
        totalEvents,
        users: mappedUsers,
        events: mappedEvents,
        tickets: mappedTickets
      });
    } catch (err: any) {
      console.error("[Supabase Error] Admin stats, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const defaultCommissionRate = await getDefaultCommissionRate();
  const eventCommissionRateById = new Map<string, number | null>(db.events.map((e: any) => [e.id, e.commissionRate != null ? Number(e.commissionRate) : null]));
  const { totalGrossRevenue: totalRevenue, totalCommission: totalPlatformCommission, effectiveCommissionRate: commissionRate } = computeCommissionBreakdown(db.tickets, eventCommissionRateById, defaultCommissionRate);
  const totalOrganizerPayout = totalRevenue - totalPlatformCommission;
  
  const totalTicketsSold = db.tickets.reduce((sum: number, t: any) => sum + t.quantity, 0);
  const totalUsers = db.users.length;
  const totalEvents = db.events.length;

  res.json({
    totalRevenue, // Gross
    totalPlatformCommission, // Commission collected by ClicBillet
    totalOrganizerPayout, // Net given out
    commissionRate,
    totalTicketsSold,
    totalUsers,
    totalEvents,
    users: db.users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    events: db.events,
    tickets: db.tickets.map(t => ({
      ...t,
      paymentStatus: t.transactionRef?.startsWith("PENDING-") ? "pending" : "paid"
    }))
  });
});

router.post("/api/admin/validate-payment", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  const { referenceNumber } = req.body;
  if (!referenceNumber) {
    return res.status(400).json({ error: "Référence ou ID du billet manquant." });
  }

  const resolvedTickets = await findTicketsByReference([referenceNumber]);
  if (resolvedTickets.length === 0) {
    return res.status(404).json({ error: "Billet introuvable." });
  }

  const confirmedCount = await confirmPaymentForTickets(resolvedTickets);
  const wasSupabase = resolvedTickets[0].source === "supabase";
  return res.json({
    success: true,
    message: wasSupabase ? "Paiement validé avec succès." : "Paiement validé localement.",
    confirmedCount
  });
});

router.delete("/api/admin/users/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  if (id === "usr-admin") {
    return res.status(400).json({ error: "Le compte administrateur principal ne peut pas être révoqué ou supprimé." });
  }

  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { error } = await adminClient
        .from("users")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return res.json({ success: true, message: "Compte utilisateur révoqué avec succès." });
    } catch (err: any) {
      console.error("[Supabase Error] Deleting user, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const index = db.users.findIndex(u => u.id === id);
  if (index !== -1) {
    db.users.splice(index, 1);
    saveDB(db);
    return res.json({ success: true, message: "Compte utilisateur révoqué avec succès." });
  }
  res.status(404).json({ error: "Utilisateur introuvable." });
});

router.get("/api/admin/payouts", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data, error } = await adminClient.from("payouts").select("*").order("request_date", { ascending: false });
      if (!error) return res.json(data.map((p: any) => ({...p, organizerId: p.organizer_id, requestDate: p.request_date})));
    } catch(e) {}
  }
  const db = getDB();
  res.json(db.payouts || []);
});

router.patch("/api/admin/payouts/:id/status", async (req: express.Request, res: express.Response) => {
  const { status } = req.body;
  if (isSupabaseEnabled && supabase) {
    try {
      const { data: updatedPayout, error } = await supabase.from("payouts").update({ status }).eq("id", req.params.id).select().maybeSingle();
      if (!error) {
        if (updatedPayout) {
          try {
            const { data: organizerUser } = await supabase.from("users").select("email,name").eq("id", updatedPayout.organizer_id).maybeSingle();
            const mappedPayout = { ...updatedPayout, organizerId: updatedPayout.organizer_id, requestDate: updatedPayout.request_date };
            runInBackground(sendOrganizerPayoutStatusEmail(organizerUser?.email, organizerUser?.name || updatedPayout.organizer_id, mappedPayout));
          } catch (e: any) {
            console.warn("[Email] Notification organisateur (statut retrait) échouée :", e.message);
          }
        }
        return res.json({ success: true });
      }
    } catch(e) {}
  }
  const db = getDB();
  db.payouts = db.payouts || [];
  const p = db.payouts.find(p => p.id === req.params.id);
  if (p) {
    p.status = status;
    saveDB(db);

    try {
      const organizerUser = db.users.find((u: any) => u.id === (p as any).organizerId);
      runInBackground(sendOrganizerPayoutStatusEmail(organizerUser?.email, organizerUser?.name || (p as any).organizerId, p));
    } catch (e: any) {
      console.warn("[Email] Notification organisateur (statut retrait) échouée :", e.message);
    }

    return res.json({ success: true });
  }
  res.status(404).json({ error: "Introuvable" });
});

// --- Transactions History ---
router.get("/api/admin/transactions", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data, error } = await adminClient.from("transactions").select("*").order("date", { ascending: false });
      if (!error) return res.json(data.map((t: any) => ({...t, eventId: t.event_id, buyerEmail: t.buyer_email, errorDetails: t.error_details})));
    } catch(e) {}
  }
  const db = getDB();
  res.json(db.transactions || []);
});

export default router;

