import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { isSupabaseEnabled, supabase, supabaseAdmin, createEphemeralAuthClient } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { runInBackground } from "../lib/utils.js";
import { sendWelcomeEmail, sendAdminNewOrganizerEmail, sendPasswordResetEmail } from "../lib/email.js";
import { buildAppOrigin } from "../lib/security.js";
import { loginRateLimiter, forgotPasswordRateLimiter } from "../lib/rateLimiters.js";
import { validateRegister, validateLogin, validateForgotPassword, validateResetPassword } from "../lib/validators.js";

const router = express.Router();

// Verrouillage par compte (voir /api/auth/login) : au-delà de ce nombre d'échecs consécutifs,
// le compte reste bloqué pendant ACCOUNT_LOCKOUT_DURATION_MS, indépendamment de l'IP d'origine.
const ACCOUNT_LOCKOUT_THRESHOLD = 5;
const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Authentication Endpoints
router.post("/api/auth/register", loginRateLimiter, validateRegister, async (req: express.Request, res: express.Response) => {
  const { email, password, name, role } = req.body;

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: "Informations d'inscription incomplètes." });
  }

  const normalizedEmail = email.toLowerCase();

  if (isSupabaseEnabled && supabase) {
    try {
      // 1. Check if user already exists in public table (just to avoid auth spam)
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (existingUser) {
        return res.status(400).json({ error: "Un utilisateur avec cet e-mail existe déjà." });
      }

      // 2. Register inside Supabase Auth via le flux signUp() standard : c'est le seul chemin
      // qui déclenche l'email de confirmation natif de Supabase Auth. L'API Admin
      // (auth.admin.createUser avec email_confirm: true) créait auparavant des comptes déjà
      // confirmés sans jamais vérifier que l'email appartient réellement à la personne qui
      // s'inscrit — n'importe qui pouvait créer un compte organisateur avec l'email de
      // quelqu'un d'autre et recevoir des billets/paiements en son nom.
      const { data: clientData, error: clientError } = await createEphemeralAuthClient().auth.signUp({
        email: normalizedEmail,
        password: password,
        options: {
          data: { name, role }
        }
      });

      if (clientError) {
        return res.status(400).json({ error: clientError.message });
      }
      const authUser = clientData?.user;

      if (!authUser) {
        return res.status(500).json({ error: "Échec de l'enregistrement de l'utilisateur sur l'authentification Supabase." });
      }

      // 3. Create public profile row linking to the native Supabase auth user.id
      const { data, error: profileError } = await supabase
        .from("users")
        .insert({
          id: authUser.id,
          email: normalizedEmail,
          password: "[SECURE_SUPABASE_AUTH]", // Mots de passe gérés en toute sécurité par Supabase Auth
          name,
          role: role === "organizer" ? "organizer" : "client"
        })
        .select()
        .single();

      if (profileError) {
        throw profileError;
      }

      // Tant que l'email n'est pas confirmé, signInWithPassword échoue (comportement Supabase
      // Auth par défaut) — on ne tente donc plus d'ouvrir une session immédiatement après
      // l'inscription. Le frontend doit inviter l'utilisateur à confirmer son adresse avant de
      // se connecter normalement via /api/auth/login.
      if (!clientData?.session) {
        return res.status(201).json({
          requiresEmailConfirmation: true,
          email: data.email,
          message: "Un e-mail de confirmation vient de vous être envoyé. Cliquez sur le lien qu'il contient avant de vous connecter."
        });
      }

      return res.status(201).json({
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        token: clientData.session.access_token,
        refreshToken: clientData.session.refresh_token
      });
    } catch (err: any) {
      console.error("[Supabase Error] User registration, falling back to local file DB:", err.message);
    }
  }

  // Fallback Database
  const db = getDB();
  const exists = db.users.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: "Un utilisateur avec cet e-mail existe déjà." });
  }

  const newUser = {
    id: `usr-${crypto.randomUUID()}`,
    email: email.toLowerCase(),
    password: bcrypt.hashSync(password, 10),
    name,
    role: role === "organizer" ? ("organizer" as const) : ("client" as const)
  };

  db.users.push(newUser);
  saveDB(db);

  // Webhook DB Supabase indisponible sur ce repli local : on envoie directement
  // l'email de bienvenue (+ notification admin si organisateur) en filet de sécurité.
  runInBackground(sendWelcomeEmail({ email: newUser.email, name: newUser.name, role: newUser.role }));
  if (newUser.role === "organizer") {
    runInBackground(sendAdminNewOrganizerEmail({ name: newUser.name, email: newUser.email }));
  }

  // Return user without password and include a local development token.
  const { password: _, ...userWithoutPassword } = newUser;
  res.status(201).json({
    ...userWithoutPassword,
    token: `local-${newUser.id}`
  });
});

router.post("/api/auth/login", loginRateLimiter, validateLogin, async (req: express.Request, res: express.Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Veuillez saisir votre email et mot de passe." });
  }

  const normalizedEmail = email.toLowerCase();

  if (isSupabaseEnabled && supabase) {
    try {
      // 0. Verrouillage par compte (complémentaire au rate limit par IP de loginRateLimiter,
      // contournable avec plusieurs IP) : un compte ayant dépassé ACCOUNT_LOCKOUT_THRESHOLD
      // échecs consécutifs reste bloqué jusqu'à l'expiration de locked_until, quelle que soit
      // l'IP d'origine des tentatives suivantes.
      const { data: lockRow } = await supabase
        .from("users")
        .select("id, failed_login_count, locked_until")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (lockRow?.locked_until && new Date(lockRow.locked_until) > new Date()) {
        return res.status(429).json({ error: "Trop de tentatives échouées pour ce compte. Réessayez plus tard ou réinitialisez votre mot de passe." });
      }

      // 1. Authenticate using Supabase Auth (Native cryptographic match).
      // Utilise un client jetable pour ne pas faire perdre à `supabase`/`supabaseAdmin` son
      // accès service_role sur les requêtes de table suivantes (cf. createEphemeralAuthClient).
      const { data: authData, error: authError } = await createEphemeralAuthClient().auth.signInWithPassword({
        email: normalizedEmail,
        password: password,
      });

      if (authError) {
        if (lockRow) {
          const newCount = (lockRow.failed_login_count || 0) + 1;
          const update: Record<string, any> = { failed_login_count: newCount };
          if (newCount >= ACCOUNT_LOCKOUT_THRESHOLD) {
            update.locked_until = new Date(Date.now() + ACCOUNT_LOCKOUT_DURATION_MS).toISOString();
          }
          await supabase.from("users").update(update).eq("id", lockRow.id);
        }

        if (authError.code === "email_not_confirmed" || /confirm/i.test(authError.message)) {
          return res.status(401).json({ error: "Veuillez confirmer votre adresse e-mail avant de vous connecter (vérifiez votre boîte de réception)." });
        }
        return res.status(401).json({ error: "Identifiant ou mot de passe incorrect. " + authError.message });
      }

      const authUser = authData?.user;
      if (!authUser) {
        return res.status(401).json({ error: "Identifiants de connexion invalides." });
      }

      // Connexion réussie : réinitialise le compteur d'échecs de ce compte.
      if (lockRow && (lockRow.failed_login_count || lockRow.locked_until)) {
        await supabase.from("users").update({ failed_login_count: 0, locked_until: null }).eq("id", lockRow.id);
      }

      // 2. Fetch profile from our public user table matching the authenticating user UUID
      let { data: profile, error: profileError } = await supabase
        .from("users")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      // Auto-healing: If user exists in Auth but not in public table, let's create it on-the-fly
      if (!profile) {
        const userMetaName = authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Abonné ClicBillet";
        const userMetaRole = authUser.user_metadata?.role || "client";

        const { data: newProfile, error: createProfileError } = await supabase
          .from("users")
          .insert({
            id: authUser.id,
            email: normalizedEmail,
            password: "[SECURE_SUPABASE_AUTH]",
            name: userMetaName,
            role: userMetaRole
          })
          .select()
          .single();

        if (createProfileError) {
          console.error("[Supabase Error] Impossibilité de créer le profil manquant :", createProfileError.message);
        } else {
          profile = newProfile;
        }
      }

      if (profile) {
        return res.json({
          id: profile.id,
          email: profile.email,
          name: profile.name,
          role: profile.role,
          token: authData?.session?.access_token,
          refreshToken: authData?.session?.refresh_token
        });
      }

      // Safe placeholder if table entry failed completely
      return res.json({
        id: authUser.id,
        email: authUser.email,
        name: authUser.email?.split("@")[0] || "Abonné ClicBillet",
        role: "client"
      });
    } catch (err: any) {
      console.error("[Supabase Error] User login, falling back to local file DB:", err.message);
    }
  }

  // Fallback database lookup
  const db = getDB();
  const user = db.users.find((u: any) => u.email.toLowerCase() === email.toLowerCase()) as any;

  if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return res.status(429).json({ error: "Trop de tentatives échouées pour ce compte. Réessayez plus tard ou réinitialisez votre mot de passe." });
  }

  if (!user || !bcrypt.compareSync(password, user.password)) {
    if (user) {
      user.failedLoginCount = (user.failedLoginCount || 0) + 1;
      if (user.failedLoginCount >= ACCOUNT_LOCKOUT_THRESHOLD) {
        user.lockedUntil = new Date(Date.now() + ACCOUNT_LOCKOUT_DURATION_MS).toISOString();
      }
      saveDB(db);
    }
    return res.status(401).json({ error: "Identifiants de connexion invalides." });
  }

  if (user.failedLoginCount || user.lockedUntil) {
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    saveDB(db);
  }

  const { password: _, ...userWithoutPassword } = user;
  res.json({
    ...userWithoutPassword,
    token: `local-${user.id}`
  });
});

// Demande de réinitialisation de mot de passe : génère un jeton à usage unique (valable 1h)
// et envoie un lien de réinitialisation par e-mail. Répond toujours avec le même message
// générique, que l'e-mail corresponde ou non à un compte existant, pour ne pas permettre à un
// attaquant de découvrir quels e-mails sont enregistrés sur la plateforme (énumération).
router.post("/api/auth/forgot-password", forgotPasswordRateLimiter, validateForgotPassword, async (req: express.Request, res: express.Response) => {
  const { email } = req.body;
  const normalizedEmail = String(email).toLowerCase();
  const genericResponse = { message: "Si un compte existe avec cette adresse e-mail, un lien de réinitialisation vient de lui être envoyé." };

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
  const resetUrl = `${buildAppOrigin(req)}/?reset_token=${rawToken}`;

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: profile } = await supabase
        .from("users")
        .select("id, name, email")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (profile) {
        const { error: insertError } = await supabase.from("password_resets").insert({
          token_hash: tokenHash,
          user_id: profile.id,
          email: profile.email,
          expires_at: expiresAt.toISOString()
        });

        if (insertError) {
          console.error("[Password Reset] Échec de la création du jeton :", insertError.message);
        } else {
          runInBackground(sendPasswordResetEmail({ email: profile.email, name: profile.name, resetUrl }));
        }
      }

      return res.json(genericResponse);
    } catch (err: any) {
      console.error("[Supabase Error] Forgot password, falling back to local file DB:", err.message);
    }
  }

  // Fallback database
  const db = getDB();
  const user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);
  if (user) {
    db.passwordResets = db.passwordResets || [];
    // Purge les jetons expirés au passage, pour ne pas faire grossir db.json indéfiniment.
    db.passwordResets = db.passwordResets.filter((r: any) => new Date(r.expiresAt) > new Date());
    db.passwordResets.push({
      tokenHash,
      userId: user.id,
      email: user.email,
      expiresAt: expiresAt.toISOString()
    });
    saveDB(db);
    runInBackground(sendPasswordResetEmail({ email: user.email, name: user.name, resetUrl }));
  }

  res.json(genericResponse);
});

// Finalisation de la réinitialisation : vérifie le jeton (à usage unique, 1h de validité),
// met à jour le mot de passe puis ouvre directement une session, pour éviter à l'utilisateur
// de devoir se reconnecter manuellement juste après avoir choisi son nouveau mot de passe.
router.post("/api/auth/reset-password", loginRateLimiter, validateResetPassword, async (req: express.Request, res: express.Response) => {
  const { token, newPassword } = req.body;
  const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: resetEntry, error: lookupError } = await supabase
        .from("password_resets")
        .select("*")
        .eq("token_hash", tokenHash)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (!resetEntry || new Date(resetEntry.expires_at) < new Date()) {
        if (resetEntry) await supabase.from("password_resets").delete().eq("token_hash", tokenHash);
        return res.status(400).json({ error: "Ce lien de réinitialisation est invalide ou a expiré. Veuillez refaire une demande." });
      }

      if (!supabaseAdmin) {
        return res.status(500).json({ error: "Service de réinitialisation indisponible pour le moment." });
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(resetEntry.user_id, { password: newPassword });
      if (updateError) throw updateError;

      // Jeton à usage unique : on le supprime immédiatement après consommation.
      await supabase.from("password_resets").delete().eq("token_hash", tokenHash);

      const { data: profile } = await supabase
        .from("users")
        .select("*")
        .eq("id", resetEntry.user_id)
        .maybeSingle();

      // Ouvre une session directement après la réinitialisation, comme à l'inscription
      // (cf. /api/auth/register), pour que le frontend reparte avec un token valide.
      let sessionToken: string | undefined;
      let sessionRefreshToken: string | undefined;
      try {
        const { data: signInData } = await createEphemeralAuthClient().auth.signInWithPassword({
          email: resetEntry.email,
          password: newPassword
        });
        sessionToken = signInData?.session?.access_token;
        sessionRefreshToken = signInData?.session?.refresh_token;
      } catch (signInErr: any) {
        console.warn("[Supabase Warning] Impossible d'ouvrir une session juste après la réinitialisation :", signInErr.message);
      }

      return res.json({
        id: profile?.id || resetEntry.user_id,
        email: profile?.email || resetEntry.email,
        name: profile?.name || resetEntry.email.split("@")[0],
        role: profile?.role || "client",
        token: sessionToken,
        refreshToken: sessionRefreshToken
      });
    } catch (err: any) {
      console.error("[Supabase Error] Reset password:", err.message);
      return res.status(500).json({ error: "Impossible de réinitialiser le mot de passe pour le moment." });
    }
  }

  // Fallback database
  const db = getDB();
  db.passwordResets = db.passwordResets || [];
  const resetEntry = db.passwordResets.find((r: any) => r.tokenHash === tokenHash);

  if (!resetEntry || new Date(resetEntry.expiresAt) < new Date()) {
    db.passwordResets = db.passwordResets.filter((r: any) => r.tokenHash !== tokenHash);
    saveDB(db);
    return res.status(400).json({ error: "Ce lien de réinitialisation est invalide ou a expiré. Veuillez refaire une demande." });
  }

  const user = db.users.find((u: any) => u.id === resetEntry.userId);
  if (!user) {
    return res.status(400).json({ error: "Compte introuvable pour ce lien de réinitialisation." });
  }

  user.password = bcrypt.hashSync(newPassword, 10);
  db.passwordResets = db.passwordResets.filter((r: any) => r.tokenHash !== tokenHash);
  saveDB(db);

  const { password: _, ...userWithoutPassword } = user;
  res.json({
    ...userWithoutPassword,
    token: `local-${user.id}`
  });
});

// Rafraîchissement de session : les access_token Supabase expirent (par défaut au bout
// d'1h). Le frontend appelle cette route avec le refresh_token stocké pour obtenir un
// nouveau access_token sans forcer l'utilisateur à se reconnecter manuellement.
router.post("/api/auth/refresh", async (req: express.Request, res: express.Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken manquant." });
  }

  if (!isSupabaseEnabled) {
    return res.status(400).json({ error: "Rafraîchissement de session non disponible." });
  }

  try {
    const { data, error } = await createEphemeralAuthClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      return res.status(401).json({ error: "Session expirée, veuillez vous reconnecter." });
    }
    return res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token
    });
  } catch (err: any) {
    console.error("[Supabase Error] Refresh session:", err.message);
    return res.status(401).json({ error: "Session expirée, veuillez vous reconnecter." });
  }
});

export default router;

