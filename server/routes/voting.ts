import express from "express";
import crypto from "crypto";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { requireRole, optionalAuth } from "../lib/auth.js";
import { runInBackground } from "../lib/utils.js";
import { buildWebhookNotificationUrl } from "../lib/security.js";
import { voteFreeRateLimiter } from "../lib/rateLimiters.js";
import { getDefaultCommissionRate, computeCommissionForAmounts } from "../lib/commission.js";

const router = express.Router();

function requireSupabase(res: express.Response): boolean {
  if (!isSupabaseEnabled || !supabase) {
    res.status(503).json({ error: "Fonctionnalité de vote indisponible (Supabase non configuré)." });
    return false;
  }
  return true;
}

function mapCandidate(c: any) {
  return {
    id: c.id,
    campaignId: c.campaign_id,
    name: c.name,
    photo: c.photo,
    description: c.description,
    displayOrder: c.display_order
  };
}

function mapCampaign(c: any) {
  return {
    id: c.id,
    organizerId: c.organizer_id,
    organizerName: c.organizer_name,
    eventId: c.event_id,
    title: c.title,
    description: c.description,
    banner: c.banner,
    status: c.status,
    startDate: c.start_date,
    endDate: c.end_date,
    freeVoteWindowHours: c.free_vote_window_hours,
    premiumVotePacks: c.premium_vote_packs || [],
    commissionRate: c.commission_rate != null ? Number(c.commission_rate) : null,
    createdAt: c.created_at,
    candidates: Array.isArray(c.candidates) ? c.candidates.map(mapCandidate) : undefined
  };
}

async function loadOwnedCampaign(campaignId: string, authUser: any): Promise<{ campaign: any | null; forbidden: boolean }> {
  const { data: campaign } = await supabase!.from("voting_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!campaign) return { campaign: null, forbidden: false };
  if (authUser.role !== "admin" && campaign.organizer_id !== authUser.id) {
    return { campaign, forbidden: true };
  }
  return { campaign, forbidden: false };
}

// ============================================================
// ORGANISATEUR : gestion des campagnes (self-service, pas de validation admin)
// ============================================================

router.get("/api/organizer/voting-campaigns", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const authUser = (req as any).user;
  const requestedOrganizerId = String(req.query.organizerId || authUser.id || "");
  if (authUser.role !== "admin" && requestedOrganizerId !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : ressource d'un autre organisateur." });
  }

  const { data, error } = await supabase!
    .from("voting_campaigns")
    .select("*, candidates(*)")
    .eq("organizer_id", requestedOrganizerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Voting] Erreur liste campagnes organisateur:", error.message);
    return res.status(500).json({ error: "Erreur lors du chargement des campagnes." });
  }
  res.json((data || []).map(mapCampaign));
});

router.post("/api/organizer/voting-campaigns", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const authUser = (req as any).user;
  const { title, description, banner, eventId, startDate, endDate, freeVoteWindowHours, premiumVotePacks, organizerName } = req.body;

  if (!title || !startDate || !endDate) {
    return res.status(400).json({ error: "Titre, date de début et date de fin sont obligatoires." });
  }
  if (new Date(endDate) <= new Date(startDate)) {
    return res.status(400).json({ error: "La date de fin doit être après la date de début." });
  }

  const id = `vc-${Date.now()}`;
  const { data, error } = await supabase!
    .from("voting_campaigns")
    .insert({
      id,
      organizer_id: authUser.id,
      organizer_name: organizerName || "Organisateur ClicBillet",
      event_id: eventId || null,
      title,
      description: description || "",
      banner: banner || null,
      status: "draft",
      start_date: startDate,
      end_date: endDate,
      free_vote_window_hours: Number(freeVoteWindowHours) || 24,
      premium_vote_packs: Array.isArray(premiumVotePacks) ? premiumVotePacks : []
    })
    .select()
    .single();

  if (error) {
    console.error("[Voting] Erreur création campagne:", error.message);
    return res.status(500).json({ error: "Erreur lors de la création de la campagne." });
  }
  res.status(201).json(mapCampaign(data));
});

router.put("/api/organizer/voting-campaigns/:id", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const authUser = (req as any).user;
  const { id } = req.params;
  const { campaign, forbidden } = await loadOwnedCampaign(id, authUser);
  if (!campaign) return res.status(404).json({ error: "Campagne introuvable." });
  if (forbidden) return res.status(403).json({ error: "Vous n'êtes pas autorisé à modifier cette campagne." });

  const { title, description, banner, startDate, endDate, freeVoteWindowHours, premiumVotePacks, status } = req.body;
  const allowedStatuses = ["draft", "active", "closed"];
  if (status !== undefined && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: "Statut invalide (attendu : draft, active ou closed)." });
  }
  // Seul l'admin peut lever une suspension : un organisateur ne peut pas repasser "active"
  // une campagne que l'admin a suspendue pour fraude/litige.
  if (campaign.status === "suspended" && status && status !== "suspended" && authUser.role !== "admin") {
    return res.status(403).json({ error: "Cette campagne est suspendue par un administrateur." });
  }

  const { data, error } = await supabase!
    .from("voting_campaigns")
    .update({
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(banner !== undefined ? { banner } : {}),
      ...(startDate !== undefined ? { start_date: startDate } : {}),
      ...(endDate !== undefined ? { end_date: endDate } : {}),
      ...(freeVoteWindowHours !== undefined ? { free_vote_window_hours: Number(freeVoteWindowHours) || 24 } : {}),
      ...(premiumVotePacks !== undefined ? { premium_vote_packs: premiumVotePacks } : {}),
      ...(status !== undefined ? { status } : {})
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[Voting] Erreur mise à jour campagne:", error.message);
    return res.status(500).json({ error: "Erreur lors de la mise à jour de la campagne." });
  }
  res.json(mapCampaign(data));
});

router.post("/api/organizer/voting-campaigns/:id/candidates", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const authUser = (req as any).user;
  const { id } = req.params;
  const { campaign, forbidden } = await loadOwnedCampaign(id, authUser);
  if (!campaign) return res.status(404).json({ error: "Campagne introuvable." });
  if (forbidden) return res.status(403).json({ error: "Vous n'êtes pas autorisé à modifier cette campagne." });

  const { name, photo, description, displayOrder } = req.body;
  if (!name) return res.status(400).json({ error: "Le nom du candidat est obligatoire." });

  const candidateId = `cand-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const { data, error } = await supabase!
    .from("candidates")
    .insert({
      id: candidateId,
      campaign_id: id,
      name,
      photo: photo || null,
      description: description || "",
      display_order: Number(displayOrder) || 0
    })
    .select()
    .single();

  if (error) {
    console.error("[Voting] Erreur ajout candidat:", error.message);
    return res.status(500).json({ error: "Erreur lors de l'ajout du candidat." });
  }
  res.status(201).json(mapCandidate(data));
});

router.put("/api/organizer/voting-campaigns/:id/candidates/:candidateId", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const authUser = (req as any).user;
  const { id, candidateId } = req.params;
  const { campaign, forbidden } = await loadOwnedCampaign(id, authUser);
  if (!campaign) return res.status(404).json({ error: "Campagne introuvable." });
  if (forbidden) return res.status(403).json({ error: "Vous n'êtes pas autorisé à modifier cette campagne." });

  const { name, photo, description, displayOrder } = req.body;
  const { data, error } = await supabase!
    .from("candidates")
    .update({
      ...(name !== undefined ? { name } : {}),
      ...(photo !== undefined ? { photo } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(displayOrder !== undefined ? { display_order: Number(displayOrder) || 0 } : {})
    })
    .eq("id", candidateId)
    .eq("campaign_id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[Voting] Erreur modification candidat:", error.message);
    return res.status(500).json({ error: "Erreur lors de la modification du candidat." });
  }
  if (!data) return res.status(404).json({ error: "Candidat introuvable." });
  res.json(mapCandidate(data));
});

router.delete("/api/organizer/voting-campaigns/:id/candidates/:candidateId", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const authUser = (req as any).user;
  const { id, candidateId } = req.params;
  const { campaign, forbidden } = await loadOwnedCampaign(id, authUser);
  if (!campaign) return res.status(404).json({ error: "Campagne introuvable." });
  if (forbidden) return res.status(403).json({ error: "Vous n'êtes pas autorisé à modifier cette campagne." });

  const { error } = await supabase!.from("candidates").delete().eq("id", candidateId).eq("campaign_id", id);
  if (error) {
    console.error("[Voting] Erreur suppression candidat:", error.message);
    return res.status(500).json({ error: "Erreur lors de la suppression du candidat." });
  }
  res.json({ success: true });
});

router.get("/api/organizer/voting-campaigns/:id/stats", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const authUser = (req as any).user;
  const { id } = req.params;
  const { campaign, forbidden } = await loadOwnedCampaign(id, authUser);
  if (!campaign) return res.status(404).json({ error: "Campagne introuvable." });
  if (forbidden) return res.status(403).json({ error: "Accès refusé : ressource d'un autre organisateur." });

  const stats = await computeCampaignStats(id, campaign);
  res.json(stats);
});

// ============================================================
// ADMIN : supervision globale
// ============================================================

router.get("/api/admin/voting-campaigns", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase!
    .from("voting_campaigns")
    .select("*, candidates(*)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Voting] Erreur liste campagnes admin:", error.message);
    return res.status(500).json({ error: "Erreur lors du chargement des campagnes." });
  }
  res.json((data || []).map(mapCampaign));
});

router.patch("/api/admin/voting-campaigns/:id/suspend", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const { id } = req.params;
  const { suspend } = req.body;

  const { data: campaign } = await supabase!.from("voting_campaigns").select("status").eq("id", id).maybeSingle();
  if (!campaign) return res.status(404).json({ error: "Campagne introuvable." });

  const newStatus = suspend ? "suspended" : "active";
  const { error } = await supabase!.from("voting_campaigns").update({ status: newStatus }).eq("id", id);
  if (error) {
    console.error("[Voting] Erreur suspension campagne:", error.message);
    return res.status(500).json({ error: "Erreur lors de la mise à jour du statut." });
  }
  res.json({ success: true, status: newStatus });
});

router.patch("/api/admin/voting-campaigns/:id/commission", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const { id } = req.params;
  const { commissionRate } = req.body;

  if (commissionRate !== null && (typeof commissionRate !== "number" || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1)) {
    return res.status(400).json({ error: "Taux de commission invalide (attendu : nombre entre 0 et 1, ou null pour réinitialiser)." });
  }

  const { error } = await supabase!.from("voting_campaigns").update({ commission_rate: commissionRate }).eq("id", id);
  if (error) {
    console.error("[Voting] Erreur commission campagne:", error.message);
    return res.status(500).json({ error: "Erreur lors de la mise à jour du taux de commission." });
  }
  res.json({ success: true, commissionRate });
});

router.get("/api/admin/voting-stats", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const { data: campaigns, error: campaignsError } = await supabase!.from("voting_campaigns").select("id, commission_rate");
  const { data: transactions, error: txError } = await supabase!.from("vote_transactions").select("*").eq("status", "paid");

  if (campaignsError || txError) {
    console.error("[Voting] Erreur stats admin:", campaignsError?.message || txError?.message);
    return res.status(500).json({ error: "Erreur lors du chargement des statistiques de vote." });
  }

  const defaultRate = await getDefaultCommissionRate("vote_commission_rate");
  const rateById = new Map<string, number | null>((campaigns || []).map((c: any) => [c.id, c.commission_rate != null ? Number(c.commission_rate) : null]));
  const amountsByGroupId = new Map<string, number>();
  for (const tx of transactions || []) {
    amountsByGroupId.set(tx.campaign_id, (amountsByGroupId.get(tx.campaign_id) || 0) + Number(tx.amount || 0));
  }
  const breakdown = computeCommissionForAmounts(amountsByGroupId, rateById, defaultRate);

  res.json({
    totalCampaigns: (campaigns || []).length,
    totalPremiumRevenue: breakdown.totalGrossRevenue,
    totalCommission: breakdown.totalCommission,
    totalOrganizerPayout: breakdown.totalRevenue,
    commissionRate: breakdown.effectiveCommissionRate
  });
});

async function computeCampaignStats(campaignId: string, campaign: any) {
  const { data: votes } = await supabase!
    .from("votes")
    .select("*")
    .eq("campaign_id", campaignId)
    .or("transaction_ref.is.null,and(transaction_ref.not.like.PENDING-%,transaction_ref.not.like.FAILED-%)");

  const freeVotes = (votes || []).filter((v: any) => v.type === "free").reduce((sum: number, v: any) => sum + Number(v.quantity || 1), 0);
  const premiumVotes = (votes || []).filter((v: any) => v.type === "premium").reduce((sum: number, v: any) => sum + Number(v.quantity || 1), 0);

  const { data: paidTx } = await supabase!.from("vote_transactions").select("amount").eq("campaign_id", campaignId).eq("status", "paid");
  const totalGrossRevenue = (paidTx || []).reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

  const defaultRate = await getDefaultCommissionRate("vote_commission_rate");
  const rate = campaign.commission_rate != null ? Number(campaign.commission_rate) : defaultRate;
  const totalCommission = Math.floor(totalGrossRevenue * rate);
  const totalRevenue = totalGrossRevenue - totalCommission;

  const byCandidate: Record<string, { free: number; premium: number }> = {};
  for (const v of votes || []) {
    if (!byCandidate[v.candidate_id]) byCandidate[v.candidate_id] = { free: 0, premium: 0 };
    byCandidate[v.candidate_id][v.type === "premium" ? "premium" : "free"] += Number(v.quantity || 1);
  }

  return { freeVotes, premiumVotes, totalGrossRevenue, totalCommission, totalRevenue, commissionRate: rate, byCandidate };
}

// ============================================================
// PUBLIC : lecture (repli serveur quand le client ne peut pas lire Supabase
// directement, ex: VITE_SUPABASE_URL absent sur cet environnement de déploiement
// — même rôle que GET /api/events pour src/lib/publicEvents.ts).
// ============================================================

router.get("/api/voting/campaigns", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase!
    .from("voting_campaigns")
    .select("*, candidates(*)")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Voting] Erreur liste campagnes publiques:", error.message);
    return res.status(500).json({ error: "Erreur lors du chargement des campagnes." });
  }
  res.set("Cache-Control", "public, max-age=20, stale-while-revalidate=60");
  res.json((data || []).map(mapCampaign));
});

router.get("/api/voting/campaigns/:campaignId/vote-counts", async (req: express.Request, res: express.Response) => {
  if (!requireSupabase(res)) return;
  const { campaignId } = req.params;
  const { data, error } = await supabase!.rpc("get_public_campaign_vote_counts", { p_campaign_id: campaignId });
  if (error) {
    console.error("[Voting] Erreur décompte de voix publiques:", error.message);
    return res.status(500).json({ error: "Erreur lors du chargement des voix." });
  }
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.candidate_id] = Number(row.votes);
  }
  res.json(counts);
});

// ============================================================
// PUBLIC : voter (gratuit + premium)
// ============================================================

async function assertCampaignVotable(campaignId: string, candidateId: string, res: express.Response): Promise<{ campaign: any; candidate: any } | null> {
  const { data: campaign } = await supabase!.from("voting_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!campaign || campaign.status !== "active") {
    res.status(404).json({ error: "Campagne de vote introuvable ou non active." });
    return null;
  }
  const now = new Date();
  if (campaign.start_date && now < new Date(campaign.start_date)) {
    res.status(400).json({ error: "Cette campagne de vote n'a pas encore commencé." });
    return null;
  }
  if (campaign.end_date && now > new Date(campaign.end_date)) {
    res.status(400).json({ error: "Cette campagne de vote est terminée." });
    return null;
  }
  const { data: candidate } = await supabase!.from("candidates").select("*").eq("id", candidateId).eq("campaign_id", campaignId).maybeSingle();
  if (!candidate) {
    res.status(404).json({ error: "Candidat introuvable pour cette campagne." });
    return null;
  }
  return { campaign, candidate };
}

router.post(
  "/api/voting/campaigns/:campaignId/candidates/:candidateId/vote-free",
  voteFreeRateLimiter,
  optionalAuth,
  async (req: express.Request, res: express.Response) => {
    if (!requireSupabase(res)) return;
    const authUser = (req as any).user;
    const { campaignId, candidateId } = req.params;
    const { deviceFingerprint } = req.body;

    const ctx = await assertCampaignVotable(campaignId, candidateId, res);
    if (!ctx) return;

    // Identité de l'électeur : compte connecté si disponible, sinon IP + empreinte device
    // envoyée par le client (cf. src/lib/voterIdentity.ts). Ni infaillible ni anti-VPN,
    // mais suffisant pour dissuader le bourrage d'urnes occasionnel (pas un CAPTCHA).
    const voterIdentity = authUser?.id || `${req.ip}:${deviceFingerprint || "unknown"}`;
    if (!authUser?.id && !deviceFingerprint) {
      return res.status(400).json({ error: "Identification du navigateur requise pour voter sans compte." });
    }

    const dayBucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const dedupKey = crypto.createHash("sha256").update(`${campaignId}:${candidateId}:${voterIdentity}:${dayBucket}`).digest("hex");

    const { error } = await supabase!.from("votes").insert({
      id: `vote-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      campaign_id: campaignId,
      candidate_id: candidateId,
      type: "free",
      quantity: 1,
      voter_user_id: authUser?.id || null,
      dedup_key: dedupKey
    });

    if (error) {
      // Violation de la contrainte unique idx_votes_dedup_key_unique = déjà voté aujourd'hui.
      if (error.code === "23505") {
        return res.status(409).json({ error: "Vous avez déjà voté gratuitement pour ce candidat aujourd'hui." });
      }
      console.error("[Voting] Erreur vote gratuit:", error.message);
      return res.status(500).json({ error: "Erreur lors de l'enregistrement du vote." });
    }

    res.status(201).json({ success: true });
  }
);

router.post(
  "/api/voting/campaigns/:campaignId/candidates/:candidateId/vote-premium/checkout",
  optionalAuth,
  async (req: express.Request, res: express.Response) => {
    if (!requireSupabase(res)) return;
    const authUser = (req as any).user;
    const { campaignId, candidateId } = req.params;
    const { votesQty, buyerEmail: bodyEmail, buyerPhone, paymentDetails } = req.body;

    const ctx = await assertCampaignVotable(campaignId, candidateId, res);
    if (!ctx) return;
    const { campaign } = ctx;

    const buyerEmail = authUser?.email ?? bodyEmail;
    if (!buyerEmail || !paymentDetails?.method) {
      return res.status(400).json({ error: "Email de l'acheteur et moyen de paiement requis." });
    }
    const allowedMethods = ["orange_money", "mtn_momo", "moov_money", "wave", "card"];
    if (!allowedMethods.includes(paymentDetails.method)) {
      return res.status(400).json({ error: "Moyen de paiement invalide." });
    }

    // Le prix vient exclusivement des packs définis par l'organisateur (jamais du client) :
    // on retrouve le pack correspondant à la quantité demandée dans premium_vote_packs.
    const packs: Array<{ votes: number; price: number }> = campaign.premium_vote_packs || [];
    const pack = packs.find((p) => Number(p.votes) === Number(votesQty));
    if (!pack) {
      return res.status(400).json({ error: "Ce pack de voix n'existe pas pour cette campagne." });
    }

    const orderId = `VOTE-ORD-${Date.now()}`;
    const code = { orange_money: "OM", mtn_momo: "MTN", moov_money: "MOOV", wave: "WAVE", card: "CARD" }[paymentDetails.method as string] || "PAY";
    const transactionRef = `PENDING-VOTE-${code}-${Math.floor(1000000 + Math.random() * 9000000)}`;

    const { error: voteInsertError } = await supabase!.from("votes").insert({
      id: orderId,
      campaign_id: campaignId,
      candidate_id: candidateId,
      order_id: orderId,
      type: "premium",
      quantity: pack.votes,
      voter_user_id: authUser?.id || null,
      voter_email: buyerEmail,
      voter_phone: buyerPhone || null,
      transaction_ref: transactionRef
    });
    if (voteInsertError) {
      console.error("[Voting] Erreur création commande de voix:", voteInsertError.message);
      return res.status(500).json({ error: "Erreur lors de la création de la commande de voix." });
    }

    try {
      await supabase!.from("vote_transactions").insert({
        id: orderId,
        campaign_id: campaignId,
        buyer_email: buyerEmail,
        buyer_phone: buyerPhone || null,
        votes_qty: pack.votes,
        amount: pack.price,
        status: "pending",
        method: paymentDetails.method
      });
    } catch (e: any) {
      console.warn("[Voting] Erreur log vote_transactions:", e.message);
    }

    res.status(201).json({
      success: true,
      orderId,
      amount: pack.price,
      votesQty: pack.votes,
      notificationUrl: buildWebhookNotificationUrl(req)
    });
  }
);

export default router;
