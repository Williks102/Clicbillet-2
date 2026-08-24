import express from "express";
import crypto from "crypto";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { runInBackground } from "../lib/utils.js";
import { sendAdminVendorRequestEmail, sendVendorRequestDecisionEmail } from "../lib/email.js";
import { vendorRequestRateLimiter } from "../lib/rateLimiters.js";
import { validateVendorRequest } from "../lib/validators.js";
import { getVendorCategories } from "../lib/vendorCategories.js";
import { createVendorProfileForUser } from "../lib/vendorProfiles.js";

const router = express.Router();

// Demande de fiche prestataire, jumeau de server/routes/organizerRequests.ts. Différence
// clé : l'approbation ne change PAS users.role (un prestataire n'est pas un rôle) — elle crée
// une ligne vendor_profiles (+ vendor_profile_categories) rattachée au compte demandeur.
// N'importe quel compte (client, organisateur, admin) peut demander une fiche. Un admin peut
// aussi créer directement un compte ET sa fiche sans passer par une demande
// (POST /api/admin/users, server/routes/admin.ts) — les deux chemins créent la même ligne
// vendor_profiles via server/lib/vendorProfiles.ts.

type RequestStatus = "pending" | "approved" | "rejected";

interface MappedVendorRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPublicCode: string | null;
  businessName: string;
  phone: string;
  city: string;
  description: string | null;
  categorySlugs: string[];
  status: RequestStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function mapSupabaseRow(row: any, publicCode?: string | null): MappedVendorRequest {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || "",
    userEmail: row.user_email || "",
    userPublicCode: publicCode ?? null,
    businessName: row.business_name,
    phone: row.phone,
    city: row.city,
    description: row.description || null,
    categorySlugs: row.category_slugs || [],
    status: row.status,
    reviewNote: row.review_note || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at
  };
}

function localRequests(db: any): any[] {
  if (!Array.isArray(db.vendorRequests)) db.vendorRequests = [];
  return db.vendorRequests;
}

// --- Côté demandeur ---

router.post(
  "/api/account/vendor-request",
  requireAuth,
  vendorRequestRateLimiter,
  validateVendorRequest,
  async (req: express.Request, res: express.Response) => {
    const authUser = req.user!;
    const { businessName, phone, city, description, categorySlugs } = req.body;

    // Résolution des catégories contre le référentiel actif : la forme (1 à 3 chaînes) a déjà
    // été vérifiée par validateVendorRequest, ici on vérifie qu'elles EXISTENT et sont
    // proposées — comme resoudreCategorie() pour les événements.
    const actives = await getVendorCategories();
    const activeSlugSet = new Set(actives.map((c) => c.slug));
    const resolvedSlugs: string[] = [...new Set((categorySlugs as string[]).map((s) => s.trim()))];
    if (resolvedSlugs.some((s) => !activeSlugSet.has(s))) {
      return res.status(400).json({ error: "Une ou plusieurs catégories choisies n'existent pas ou plus." });
    }

    const trimmedDescription = String(description || "").trim().slice(0, 1000) || null;

    if (isSupabaseEnabled && supabase) {
      try {
        const { data: profile } = await supabase
          .from("users")
          .select("id, name, email, public_code")
          .eq("id", authUser.id)
          .maybeSingle();

        const { data, error } = await supabase
          .from("vendor_requests")
          .insert({
            id: `vrq-${crypto.randomUUID()}`,
            user_id: authUser.id,
            user_name: profile?.name || authUser.email,
            user_email: profile?.email || authUser.email,
            business_name: String(businessName).trim(),
            phone: String(phone),
            city: String(city).trim(),
            description: trimmedDescription,
            category_slugs: resolvedSlugs,
            status: "pending"
          })
          .select()
          .single();

        if (error) {
          // 23505 sur vendor_requests_one_pending_per_user : une demande est déjà ouverte.
          if ((error as any).code === "23505") {
            return res.status(409).json({ error: "Une demande est déjà en cours d'examen pour votre compte." });
          }
          throw error;
        }

        const mapped = mapSupabaseRow(data, profile?.public_code);
        runInBackground(sendAdminVendorRequestEmail({
          userName: mapped.userName,
          userEmail: mapped.userEmail,
          publicCode: mapped.userPublicCode,
          businessName: mapped.businessName,
          phone: mapped.phone,
          city: mapped.city,
          categoryLabels: actives.filter((c) => resolvedSlugs.includes(c.slug)).map((c) => c.label),
          description: mapped.description
        }));

        return res.status(201).json(mapped);
      } catch (err: any) {
        console.error("[Supabase Error] Création de la demande prestataire, repli sur db.json :", err.message);
      }
    }

    const db = getDB();
    const requests = localRequests(db);
    if (requests.some((r: any) => r.userId === authUser.id && r.status === "pending")) {
      return res.status(409).json({ error: "Une demande est déjà en cours d'examen pour votre compte." });
    }

    const dbUser = db.users.find((u: any) => u.id === authUser.id) as any;
    const entry = {
      id: `vrq-${crypto.randomUUID()}`,
      userId: authUser.id,
      userName: dbUser?.name || authUser.email,
      userEmail: dbUser?.email || authUser.email,
      businessName: String(businessName).trim(),
      phone: String(phone),
      city: String(city).trim(),
      description: trimmedDescription,
      categorySlugs: resolvedSlugs,
      status: "pending" as RequestStatus,
      reviewNote: null,
      reviewedAt: null,
      createdAt: new Date().toISOString()
    };
    requests.push(entry);
    saveDB(db);

    runInBackground(sendAdminVendorRequestEmail({
      userName: entry.userName,
      userEmail: entry.userEmail,
      publicCode: dbUser?.publicCode || null,
      businessName: entry.businessName,
      phone: entry.phone,
      city: entry.city,
      categoryLabels: actives.filter((c) => resolvedSlugs.includes(c.slug)).map((c) => c.label),
      description: entry.description
    }));

    res.status(201).json({ ...entry, userPublicCode: dbUser?.publicCode || null });
  }
);

// Dernière demande du compte connecté (quel que soit son statut) : alimente l'encart de suivi
// dans l'espace client (BecomeVendorCard.tsx). Renvoie { request: null } si aucune demande.
router.get("/api/account/vendor-request", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = req.user!;

  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("vendor_requests")
        .select("*")
        .eq("user_id", authUser.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return res.json({ request: data ? mapSupabaseRow(data) : null });
    } catch (err: any) {
      console.error("[Supabase Error] Lecture de la demande prestataire, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const mine = localRequests(db)
    .filter((r: any) => r.userId === authUser.id)
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ request: mine[0] || null });
});

// --- Côté administrateur ---
// Le préfixe /api/admin est déjà protégé globalement (requireAuth + requireRole("admin")) dans
// server.ts ; les middlewares répétés ici gardent la route sûre même si ce montage changeait.

router.get("/api/admin/vendor-requests", requireAuth, requireRole("admin"), async (_req: express.Request, res: express.Response) => {
  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("vendor_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const userIds = [...new Set((data || []).map((r: any) => r.user_id))];
      const codeByUserId = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from("users")
          .select("id, public_code")
          .in("id", userIds);
        for (const u of users || []) codeByUserId.set(u.id, u.public_code || null);
      }

      return res.json((data || []).map((r: any) => mapSupabaseRow(r, codeByUserId.get(r.user_id))));
    } catch (err: any) {
      console.error("[Supabase Error] Liste des demandes prestataire, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const codeByUserId = new Map<string, string | null>(db.users.map((u: any) => [u.id, u.publicCode || null]));
  res.json(
    localRequests(db)
      .map((r: any) => ({ ...r, userPublicCode: codeByUserId.get(r.userId) || null }))
      .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
  );
});

router.patch("/api/admin/vendor-requests/:id", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  const admin = req.user!;
  const { status, reviewNote } = req.body;

  if (status !== "approved" && status !== "rejected") {
    return res.status(400).json({ error: "Statut invalide : 'approved' ou 'rejected' attendu." });
  }
  if (reviewNote !== undefined && (typeof reviewNote !== "string" || reviewNote.length > 1000)) {
    return res.status(400).json({ error: "Le message de décision ne peut pas dépasser 1000 caractères." });
  }

  const trimmedNote = String(reviewNote || "").trim() || null;
  const reviewedAt = new Date().toISOString();

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: request, error: readError } = await supabase
        .from("vendor_requests")
        .select("*")
        .eq("id", req.params.id)
        .maybeSingle();
      if (readError) throw readError;
      if (!request) {
        return res.status(404).json({ error: "Demande introuvable." });
      }
      if (request.status !== "pending") {
        return res.status(409).json({ error: "Cette demande a déjà été traitée." });
      }

      // Création du profil AVANT l'enregistrement de la décision : si elle échoue, la demande
      // reste "pending" et pourra être retraitée, plutôt que de marquer une demande approuvée
      // sans fiche derrière — même ordre de garde que l'approbation organisateur.
      if (status === "approved") {
        const result = await createVendorProfileForUser({
          userId: request.user_id,
          businessName: request.business_name,
          phone: request.phone,
          city: request.city,
          description: request.description,
          categorySlugs: request.category_slugs || []
        });
        if (!result.ok) {
          return res.status(result.status).json({ error: result.error });
        }
      }

      const { data: updated, error: updateError } = await supabase
        .from("vendor_requests")
        .update({ status, review_note: trimmedNote, reviewed_by: admin.id, reviewed_at: reviewedAt })
        .eq("id", request.id)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) {
        return res.status(409).json({ error: "Cette demande a déjà été traitée." });
      }

      runInBackground(sendVendorRequestDecisionEmail(
        { email: request.user_email, name: request.user_name || request.user_email },
        status,
        trimmedNote
      ));

      return res.json(mapSupabaseRow(updated));
    } catch (err: any) {
      console.error("[Supabase Error] Traitement de la demande prestataire :", err.message);
      return res.status(500).json({ error: "Impossible de traiter cette demande pour le moment." });
    }
  }

  const db = getDB();
  const request = localRequests(db).find((r: any) => r.id === req.params.id);
  if (!request) {
    return res.status(404).json({ error: "Demande introuvable." });
  }
  if (request.status !== "pending") {
    return res.status(409).json({ error: "Cette demande a déjà été traitée." });
  }

  if (status === "approved") {
    const result = await createVendorProfileForUser({
      userId: request.userId,
      businessName: request.businessName,
      phone: request.phone,
      city: request.city,
      description: request.description,
      categorySlugs: request.categorySlugs || []
    }, db);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
  }

  request.status = status;
  request.reviewNote = trimmedNote;
  request.reviewedBy = admin.id;
  request.reviewedAt = reviewedAt;
  saveDB(db);

  runInBackground(sendVendorRequestDecisionEmail(
    { email: request.userEmail, name: request.userName || request.userEmail },
    status,
    trimmedNote
  ));

  res.json(request);
});

export default router;
