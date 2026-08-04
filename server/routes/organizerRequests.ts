import express from "express";
import crypto from "crypto";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { runInBackground } from "../lib/utils.js";
import { sendAdminOrganizerRequestEmail, sendOrganizerRequestDecisionEmail } from "../lib/email.js";
import { organizerRequestRateLimiter } from "../lib/rateLimiters.js";
import { validateOrganizerRequest } from "../lib/validators.js";

const router = express.Router();

// Passage acheteur -> organisateur.
//
// Le rôle est choisi à l'inscription et n'est modifiable par aucune route "normale" : la seule
// écriture de users.role après création d'un compte se fait ici, à l'approbation d'une demande
// par un administrateur (PATCH /api/admin/organizer-requests/:id). Un compte organisateur peut
// créer des événements, encaisser des paiements et demander des retraits — la bascule reste
// donc soumise à validation humaine, jamais en libre-service.
//
// Le compte lui-même n'est PAS recréé : même id, même e-mail, mêmes billets déjà achetés.
// C'est tout l'intérêt par rapport au contournement actuel (créer un second compte avec une
// autre adresse), qui coupait l'utilisateur de son historique.

type RequestStatus = "pending" | "approved" | "rejected";

interface MappedRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPublicCode: string | null;
  organizationName: string;
  phone: string;
  motivation: string | null;
  status: RequestStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function mapSupabaseRow(row: any, publicCode?: string | null): MappedRequest {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || "",
    userEmail: row.user_email || "",
    userPublicCode: publicCode ?? null,
    organizationName: row.organization_name,
    phone: row.phone,
    motivation: row.motivation || null,
    status: row.status,
    reviewNote: row.review_note || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at
  };
}

function localRequests(db: any): any[] {
  if (!Array.isArray(db.organizerRequests)) db.organizerRequests = [];
  return db.organizerRequests;
}

// --- Côté demandeur ---

router.post(
  "/api/account/organizer-request",
  requireAuth,
  organizerRequestRateLimiter,
  validateOrganizerRequest,
  async (req: express.Request, res: express.Response) => {
    const authUser = req.user!;
    const { organizationName, phone, motivation } = req.body;

    if (authUser.role === "organizer" || authUser.role === "admin") {
      return res.status(409).json({ error: "Votre compte dispose déjà d'un accès organisateur." });
    }

    const trimmedMotivation = String(motivation || "").trim().slice(0, 1000) || null;

    if (isSupabaseEnabled && supabase) {
      try {
        const { data: profile } = await supabase
          .from("users")
          .select("id, name, email, public_code")
          .eq("id", authUser.id)
          .maybeSingle();

        const { data, error } = await supabase
          .from("organizer_requests")
          .insert({
            id: `orq-${crypto.randomUUID()}`,
            user_id: authUser.id,
            user_name: profile?.name || authUser.email,
            user_email: profile?.email || authUser.email,
            organization_name: String(organizationName).trim(),
            phone: String(phone),
            motivation: trimmedMotivation,
            status: "pending"
          })
          .select()
          .single();

        if (error) {
          // 23505 sur organizer_requests_one_pending_per_user : une demande est déjà ouverte.
          // On répond 409 plutôt que 500 — c'est un état normal, pas une panne.
          if ((error as any).code === "23505") {
            return res.status(409).json({ error: "Une demande est déjà en cours d'examen pour votre compte." });
          }
          throw error;
        }

        const mapped = mapSupabaseRow(data, profile?.public_code);
        runInBackground(sendAdminOrganizerRequestEmail({
          userName: mapped.userName,
          userEmail: mapped.userEmail,
          publicCode: mapped.userPublicCode,
          organizationName: mapped.organizationName,
          phone: mapped.phone,
          motivation: mapped.motivation
        }));

        return res.status(201).json(mapped);
      } catch (err: any) {
        console.error("[Supabase Error] Création de la demande organisateur, repli sur db.json :", err.message);
      }
    }

    const db = getDB();
    const requests = localRequests(db);
    if (requests.some((r: any) => r.userId === authUser.id && r.status === "pending")) {
      return res.status(409).json({ error: "Une demande est déjà en cours d'examen pour votre compte." });
    }

    const dbUser = db.users.find((u: any) => u.id === authUser.id) as any;
    const entry = {
      id: `orq-${crypto.randomUUID()}`,
      userId: authUser.id,
      userName: dbUser?.name || authUser.email,
      userEmail: dbUser?.email || authUser.email,
      organizationName: String(organizationName).trim(),
      phone: String(phone),
      motivation: trimmedMotivation,
      status: "pending" as RequestStatus,
      reviewNote: null,
      reviewedAt: null,
      createdAt: new Date().toISOString()
    };
    requests.push(entry);
    saveDB(db);

    runInBackground(sendAdminOrganizerRequestEmail({
      userName: entry.userName,
      userEmail: entry.userEmail,
      publicCode: dbUser?.publicCode || null,
      organizationName: entry.organizationName,
      phone: entry.phone,
      motivation: entry.motivation
    }));

    res.status(201).json({ ...entry, userPublicCode: dbUser?.publicCode || null });
  }
);

// Dernière demande du compte connecté (quel que soit son statut) : alimente l'encart de suivi
// dans l'espace client. Renvoie { request: null } quand l'utilisateur n'a jamais rien demandé.
router.get("/api/account/organizer-request", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = req.user!;

  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("organizer_requests")
        .select("*")
        .eq("user_id", authUser.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return res.json({ request: data ? mapSupabaseRow(data) : null });
    } catch (err: any) {
      console.error("[Supabase Error] Lecture de la demande organisateur, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const mine = localRequests(db)
    .filter((r: any) => r.userId === authUser.id)
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ request: mine[0] || null });
});

// --- Côté administrateur ---
// Le préfixe /api/admin est déjà protégé globalement par requireAuth + requireRole("admin")
// dans server.ts ; les middlewares répétés ici gardent la route sûre même si ce montage
// global changeait, plutôt que de dépendre d'un fichier distant pour son autorisation.

router.get("/api/admin/organizer-requests", requireAuth, requireRole("admin"), async (_req: express.Request, res: express.Response) => {
  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("organizer_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Le code public sert de référence commune entre la file de modération et le reste du
      // back-office : on le joint en une seule requête plutôt qu'une par demande.
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
      console.error("[Supabase Error] Liste des demandes organisateur, repli sur db.json :", err.message);
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

router.patch("/api/admin/organizer-requests/:id", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
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
        .from("organizer_requests")
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

      // La promotion du rôle vient AVANT l'enregistrement de la décision : si l'écriture du
      // rôle échoue, la demande reste "pending" et pourra être retraitée. L'inverse laisserait
      // une demande marquée approuvée sur un compte resté acheteur, sans plus rien pour le
      // signaler dans la file de modération.
      if (status === "approved") {
        const { error: roleError } = await supabase
          .from("users")
          .update({ role: "organizer" })
          .eq("id", request.user_id);
        if (roleError) throw roleError;
      }

      const { data: updated, error: updateError } = await supabase
        .from("organizer_requests")
        .update({ status, review_note: trimmedNote, reviewed_by: admin.id, reviewed_at: reviewedAt })
        .eq("id", request.id)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) {
        return res.status(409).json({ error: "Cette demande a déjà été traitée." });
      }

      runInBackground(sendOrganizerRequestDecisionEmail(
        { email: request.user_email, name: request.user_name || request.user_email },
        status,
        trimmedNote
      ));

      return res.json(mapSupabaseRow(updated));
    } catch (err: any) {
      console.error("[Supabase Error] Traitement de la demande organisateur :", err.message);
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
    const dbUser = db.users.find((u: any) => u.id === request.userId) as any;
    if (!dbUser) {
      return res.status(404).json({ error: "Le compte lié à cette demande est introuvable." });
    }
    dbUser.role = "organizer";
  }

  request.status = status;
  request.reviewNote = trimmedNote;
  request.reviewedBy = admin.id;
  request.reviewedAt = reviewedAt;
  saveDB(db);

  runInBackground(sendOrganizerRequestDecisionEmail(
    { email: request.userEmail, name: request.userName || request.userEmail },
    status,
    trimmedNote
  ));

  res.json(request);
});

// Attribution manuelle du rôle par l'administrateur, sans demande préalable (organisateur
// démarché en direct, compte créé par erreur en "acheteur"...). Volontairement limité aux
// bascules client <-> organizer : le rôle "admin" ne s'accorde pas depuis l'interface, il
// resterait sinon à la portée de n'importe quel compte admin compromis.
router.patch("/api/admin/users/:id/role", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  const { role } = req.body;
  if (role !== "client" && role !== "organizer") {
    return res.status(400).json({ error: "Rôle invalide : 'client' ou 'organizer' attendu." });
  }
  if (req.params.id === req.user!.id) {
    return res.status(400).json({ error: "Vous ne pouvez pas modifier votre propre rôle." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: target, error: readError } = await supabase
        .from("users")
        .select("id, name, email, role")
        .eq("id", req.params.id)
        .maybeSingle();
      if (readError) throw readError;
      if (!target) {
        return res.status(404).json({ error: "Utilisateur introuvable." });
      }
      if (target.role === "admin") {
        return res.status(403).json({ error: "Le rôle d'un administrateur ne peut pas être modifié ici." });
      }
      if (target.role === role) {
        return res.json({ success: true, role });
      }

      const { error: updateError } = await supabase.from("users").update({ role }).eq("id", target.id);
      if (updateError) throw updateError;

      if (role === "organizer") {
        runInBackground(sendOrganizerRequestDecisionEmail({ email: target.email, name: target.name || target.email }, "approved", null));
      }
      return res.json({ success: true, role });
    } catch (err: any) {
      console.error("[Supabase Error] Changement de rôle, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const target = db.users.find((u: any) => u.id === req.params.id) as any;
  if (!target) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }
  if (target.role === "admin") {
    return res.status(403).json({ error: "Le rôle d'un administrateur ne peut pas être modifié ici." });
  }
  if (target.role !== role) {
    target.role = role;
    saveDB(db);
    if (role === "organizer") {
      runInBackground(sendOrganizerRequestDecisionEmail({ email: target.email, name: target.name || target.email }, "approved", null));
    }
  }
  res.json({ success: true, role });
});

export default router;
