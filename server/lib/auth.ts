import express from "express";
import { isSupabaseEnabled, supabase, isProduction } from "./config.js";
import { getDB } from "./db.js";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser | null;
    }
  }
}

export function extractBearerToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

// Session utilisateur : vit dans des cookies httpOnly (jamais lisibles par du JS, donc
// invulnérables au vol par XSS — contrairement à un stockage localStorage) plutôt que dans le
// header Authorization. extractBearerToken() ci-dessus reste utilisée telle quelle par
// server/routes/webhooks.ts pour un usage sans rapport (secret partagé statique, pas une
// session utilisateur) : ne pas fusionner les deux mécanismes.
export const SESSION_ACCESS_COOKIE = "cb_access_token";
export const SESSION_REFRESH_COOKIE = "cb_refresh_token";

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours (durée de vie du cookie, pas du JWT lui-même)

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS
  };
}

export function setSessionCookies(res: express.Response, session: { token?: string; refreshToken?: string }) {
  if (session.token) {
    res.cookie(SESSION_ACCESS_COOKIE, session.token, baseCookieOptions());
  }
  if (session.refreshToken) {
    res.cookie(SESSION_REFRESH_COOKIE, session.refreshToken, baseCookieOptions());
  }
}

export function clearSessionCookies(res: express.Response) {
  res.clearCookie(SESSION_ACCESS_COOKIE, { path: "/" });
  res.clearCookie(SESSION_REFRESH_COOKIE, { path: "/" });
}

// Session "en attente" pendant la double authentification (MFA) : quand un compte a activé la
// 2FA, signInWithPassword réussit (AAL1) mais ne doit PAS suffire à accorder l'accès — le
// second facteur (code TOTP) reste à vérifier. Ce couple de cookies distinct, à durée de vie
// courte, porte cette session AAL1 le temps que l'utilisateur saisisse son code, sans jamais
// être lu par getAuthenticatedUser() (qui ne connaît que SESSION_ACCESS_COOKIE) : tant que la
// vérification MFA n'a pas eu lieu, aucune route protégée n'est accessible avec ce jeton.
export const MFA_PENDING_ACCESS_COOKIE = "cb_mfa_pending_access";
export const MFA_PENDING_REFRESH_COOKIE = "cb_mfa_pending_refresh";
const MFA_PENDING_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes pour saisir le code

function mfaPendingCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MFA_PENDING_MAX_AGE_MS
  };
}

export function setMfaPendingCookies(res: express.Response, session: { token: string; refreshToken: string }) {
  res.cookie(MFA_PENDING_ACCESS_COOKIE, session.token, mfaPendingCookieOptions());
  res.cookie(MFA_PENDING_REFRESH_COOKIE, session.refreshToken, mfaPendingCookieOptions());
}

export function clearMfaPendingCookies(res: express.Response) {
  res.clearCookie(MFA_PENDING_ACCESS_COOKIE, { path: "/" });
  res.clearCookie(MFA_PENDING_REFRESH_COOKIE, { path: "/" });
}

function getSessionTokenFromCookie(req: express.Request): string | null {
  const token = (req as any).cookies?.[SESSION_ACCESS_COOKIE];
  return typeof token === "string" && token ? token : null;
}

export async function getAuthenticatedUser(req: express.Request): Promise<AuthUser | null> {
  const token = getSessionTokenFromCookie(req);
  if (!token) return null;

  // Les tokens "local-<id>" sont émis par le repli db.json (signup/login) quand Supabase
  // n'est pas configuré. Ils ne sont jamais des JWT signés : un id deviné/connu suffirait à
  // les forger. On ne les honore donc QUE si Supabase est indisponible (cas normal de prod).
  // Garde redondante, indépendante de isSupabaseEnabled : sur Vercel, VERCEL_ENV est injecté
  // par la plateforme elle-même ("production"/"preview"/"development"), jamais absent ni mal
  // configuré par erreur humaine contrairement à NODE_ENV — donc même si une mauvaise
  // configuration Supabase faisait passer isSupabaseEnabled à false sur un déploiement de
  // production, cette seconde condition referme quand même la porte aux tokens non signés.
  const localPrefix = "local-";
  if (token.startsWith(localPrefix)) {
    const isNonDevVercelDeployment = Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== "development";
    if (isSupabaseEnabled || isNonDevVercelDeployment || process.env.NODE_ENV === "production") return null;
    const localUserId = token.substring(localPrefix.length);
    if (!localUserId) return null;
    const db = getDB();
    const localUser = db.users.find((u: any) => u.id === localUserId);
    if (!localUser) return null;
    return {
      id: localUser.id,
      email: localUser.email,
      role: localUser.role
    };
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const authClient = supabase;
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) {
        return null;
      }
      const userId = data.user.id;
      const { data: profile, error: profileError } = await authClient
        .from("users")
        .select("id,email,role")
        .eq("id", userId)
        .maybeSingle();

      if (profileError || !profile) {
        return null;
      }

      return {
        id: profile.id,
        email: profile.email,
        role: profile.role
      };
    } catch (err: any) {
      console.warn("[Auth] Échec de vérification du token Supabase:", err.message);
      return null;
    }
  }

  return null;
}

export async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: "Token d'authentification manquant ou invalide." });
  }
  req.user = user;
  next();
}

export async function optionalAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  req.user = await getAuthenticatedUser(req);
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.user) {
      // Signale un bug de câblage de route (requireRole utilisé sans requireAuth avant) au
      // lieu de le masquer derrière un 403 qui a l'air d'un refus d'accès normal.
      console.error(`[Auth] requireRole() appelé sans requireAuth() sur ${req.method} ${req.path}`);
      return res.status(401).json({ error: "Authentification requise." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé : rôle insuffisant." });
    }
    next();
  };
}

