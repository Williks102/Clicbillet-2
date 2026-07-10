import express from "express";
import { supabase, supabaseAdmin } from "../lib/config";
import { getDB, saveDB } from "../lib/db";
import { requireRole } from "../lib/auth";
import { runInBackground } from "../lib/utils";
import { sendAdminPayoutRequestEmail } from "../lib/email";
import { getDefaultCommissionRate, computeCommissionBreakdown } from "../lib/commission";

const router = express.Router();

// Statistics Endpoint for Organizers
router.get("/api/organizer/export", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const requestedOrganizerId = String(req.query.organizerId || authUser.id || "");

  if (authUser.role !== "admin" && requestedOrganizerId !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : vous ne pouvez exporter que vos propres événements." });
  }

  try {
    let matchedTickets: any[] = [];
    const backendClient = supabaseAdmin || supabase;
    if (backendClient) {
      const { data: organizerEvents, error: eventsError } = await backendClient
        .from("events")
        .select("id")
        .eq("organizer_id", requestedOrganizerId);
      if (eventsError) throw eventsError;
      
      const eventIds = (organizerEvents || []).map((e: any) => e.id);
      if (eventIds.length > 0) {
        const { data: tkts, error: tktsError } = await supabase
          .from("tickets")
          .select("*")
          .in("event_id", eventIds)
          .order("purchase_date", { ascending: false });
        if (tktsError) throw tktsError;
        matchedTickets = tkts || [];
      }
    } else {
      const db = getDB();
      const organizerEvents = db.events.filter((e: any) => e.organizerId === requestedOrganizerId);
      const eventIds = organizerEvents.map((e: any) => e.id);
      matchedTickets = db.tickets.filter((t: any) => eventIds.includes(t.eventId));
    }
    
    // Generate CSV
    const header = [
      "ID Transaction",
      "Date d'Achat",
      "Événement",
      "Client",
      "Email Client",
      "Quantité",
      "Catégorie",
      "Prix Payé (XOF)",
      "Statut"
    ].join(",");

    const rows = matchedTickets.map((t: any) => [
      t.transaction_ref || t.transactionRef || "",
      t.purchase_date || t.purchaseDate || "",
      `"${(t.event_title || t.eventTitle || "").replace(/"/g, '""')}"`,
      `"${(t.buyer_name || t.buyerName || "").replace(/"/g, '""')}"`,
      `"${(t.buyer_email || t.buyerEmail || "").replace(/"/g, '""')}"`,
      t.quantity || 1,
      t.tier || "standard",
      t.price_paid || t.pricePaid || 0,
      t.payment_status || t.paymentStatus || "paid"
    ].join(","));

    const csvData = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="clicbillet_export_${Date.now()}.csv"`);
    res.status(200).send(csvData);
  } catch (err: any) {
    console.error("Export error", err);
    res.status(500).json({ error: "Erreur lors de l'exportation." });
  }
});

router.get("/api/organizer/stats", async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { organizerId } = req.query;

  if (!organizerId) {
    return res.status(400).json({ error: "organizerId requis." });
  }

  // Anti-IDOR : un organisateur ne peut consulter que ses propres statistiques
  // (chiffre d'affaires, ventes, emails clients), pas celles d'un confrère.
  if (authUser.role !== "admin" && String(organizerId) !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : ressource d'un autre organisateur." });
  }

  if (supabase) {
    try {
      const backendClient = supabaseAdmin || supabase;
      // 1. Get organizer events
      const { data: organizerEvents, error: eventsError } = await backendClient
        .from("events")
        .select("*")
        .eq("organizer_id", organizerId);

      if (eventsError) throw eventsError;

      const eventIds = (organizerEvents || []).map((e: any) => e.id);

      // 2. Get tickets for those events
      let matchedTickets: any[] = [];
      if (eventIds.length > 0) {
        const { data: tkts, error: tktsError } = await supabase
          .from("tickets")
          .select("*")
          .in("event_id", eventIds)
          .order("purchase_date", { ascending: false });

        if (tktsError) throw tktsError;
        matchedTickets = tkts || [];
      }

      const defaultCommissionRate = await getDefaultCommissionRate();
      const eventCommissionRateById = new Map((organizerEvents || []).map((e: any) => [e.id, e.commission_rate != null ? Number(e.commission_rate) : null]));
      const { totalGrossRevenue, totalCommission, totalRevenue, effectiveCommissionRate: commissionRate } = computeCommissionBreakdown(matchedTickets, eventCommissionRateById, defaultCommissionRate);

      const ticketsSold = matchedTickets.reduce((sum: number, t: any) => sum + Number(t.quantity || 1), 0);
      const activeEvents = (organizerEvents || []).length;

      const recentSales = matchedTickets.slice(0, 10).map((t: any) => ({
        eventTitle: t.event_title,
        buyerName: t.buyer_name,
        amount: Number(t.price_paid),
        date: t.purchase_date,
        tier: t.tier
      }));

      const tickets = matchedTickets.map((t: any) => ({
        id: t.id,
        eventId: t.event_id,
        eventTitle: t.event_title,
        buyerName: t.buyer_name,
        buyerEmail: t.buyer_email,
        tier: t.tier,
        pricePaid: Number(t.price_paid),
        scanned: t.scanned,
        scannedAt: t.scanned_at,
        transactionRef: t.transaction_ref,
        purchaseDate: t.purchase_date,
        quantity: t.quantity
      }));

      return res.json({
        totalRevenue,
        totalGrossRevenue,
        totalCommission,
        commissionRate,
        ticketsSold,
        activeEvents,
        recentSales,
        tickets
      });
    } catch (err: any) {
      console.error("[Supabase Error] Organizer statistics, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  
  // Custom filter if and only if organizer created it. (For fallback simulation let's grant view of all tickets of their events!)
  const organizerEvents = db.events.filter((e: any) => e.organizerId === organizerId);
  const eventIds = organizerEvents.map((e: any) => e.id);

  const matchedTickets = db.tickets.filter((t: any) => eventIds.includes(t.eventId));

  const defaultCommissionRate = await getDefaultCommissionRate();
  const eventCommissionRateById = new Map<string, number | null>(organizerEvents.map((e: any) => [e.id, e.commissionRate != null ? Number(e.commissionRate) : null]));
  const { totalGrossRevenue, totalCommission, totalRevenue, effectiveCommissionRate: commissionRate } = computeCommissionBreakdown(matchedTickets, eventCommissionRateById, defaultCommissionRate);

  const ticketsSold = matchedTickets.reduce((sum: number, t: any) => sum + t.quantity, 0);
  const activeEvents = organizerEvents.length;

  const recentSales = matchedTickets.slice(0, 10).map((t: any) => ({
    eventTitle: t.eventTitle,
    buyerName: t.buyerName,
    amount: t.pricePaid,
    date: t.purchaseDate,
    tier: t.tier
  }));

  res.json({
    totalRevenue, // Net Balance
    totalGrossRevenue, // Gross 100%
    totalCommission, // 10% platform share
    commissionRate,
    ticketsSold,
    activeEvents,
    recentSales,
    tickets: matchedTickets
  });
});

// --- Payouts (Demandes de retrait) ---
router.post("/api/organizer/payouts", async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { amount, method, details } = req.body;
  if (!amount || !method) return res.status(400).json({ error: "Champs manquants" });

  // Anti-IDOR : un organisateur ne peut poser une demande de retrait que pour lui-même.
  const requestedOrganizerId = String(req.body.organizerId || authUser.id || "");
  if (authUser.role !== "admin" && requestedOrganizerId !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : ressource d'un autre organisateur." });
  }
  const organizerId = requestedOrganizerId;

  const payout = {
    id: `pay-${Date.now()}`, organizerId, amount: Number(amount), status: "pending" as const,
    requestDate: new Date().toISOString(), method, details
  };

  const backendClient = supabaseAdmin || supabase;
  if (backendClient) {
    try {
      const { error } = await backendClient.from("payouts").insert({
        id: payout.id, organizer_id: payout.organizerId, amount: payout.amount,
        status: payout.status, request_date: payout.requestDate, method: payout.method, details: payout.details
      });
      if (error) throw error;
    } catch(e: any) {
       console.warn("[Supabase Error] Payout insert, falling back to local file DB:", e.message);
    }
  }
  const db = getDB();
  db.payouts = db.payouts || [];
  db.payouts.unshift(payout as any);
  saveDB(db);

  try {
    let organizerName = db.users.find((u: any) => u.id === organizerId)?.name;
    if (!organizerName && backendClient) {
      const { data: organizerUser } = await backendClient.from("users").select("name").eq("id", organizerId).maybeSingle();
      organizerName = organizerUser?.name;
    }
    runInBackground(sendAdminPayoutRequestEmail(organizerName || organizerId, payout));
  } catch (e: any) {
    console.warn("[Email] Notification admin (demande de retrait) échouée :", e.message);
  }

  res.json({ success: true, payout });
});

router.get("/api/organizer/payouts", async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { organizerId } = req.query;

  // Anti-IDOR : un organisateur ne peut consulter que ses propres demandes de retrait
  // (qui contiennent des coordonnées bancaires/mobile money sensibles).
  if (authUser.role !== "admin" && String(organizerId) !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : ressource d'un autre organisateur." });
  }

  const backendClient = supabaseAdmin || supabase;
  if (backendClient) {
    try {
      const { data, error } = await backendClient.from("payouts").select("*").eq("organizer_id", organizerId);
      if (!error) return res.json(data.map((p: any) => ({...p, organizerId: p.organizer_id, requestDate: p.request_date})));
    } catch(e) {}
  }
  const db = getDB();
  res.json((db.payouts || []).filter(p => p.organizerId === organizerId || (p as any).organizer_id === organizerId));
});

export default router;

