import express from "express";
import { isSupabaseEnabled, supabase } from "./config.js";
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

export async function getAuthenticatedUser(req: express.Request): Promise<AuthUser | null> {
  const token = extractBearerToken(req);
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

