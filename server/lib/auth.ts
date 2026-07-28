import express from "express";
import { isSupabaseEnabled, supabase } from "./config.js";
import { getDB } from "./db.js";

export function extractBearerToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

export async function getAuthenticatedUser(req: express.Request): Promise<any | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  // Les tokens "local-<id>" sont émis par le repli db.json (signup/login) quand Supabase
  // n'est pas configuré. Ils ne sont jamais des JWT signés : un id deviné/connu (ex.
  // "usr-admin") suffirait à les forger. On ne les honore donc QUE si Supabase est
  // indisponible — dès que Supabase est configuré (cas normal de prod), ils sont rejetés.
  const localPrefix = "local-";
  if (token.startsWith(localPrefix)) {
    if (isSupabaseEnabled) return null;
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
    } catch (err) {
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
  (req as any).user = user;
  next();
}

export async function optionalAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const user = await getAuthenticatedUser(req);
  (req as any).user = user ?? null;
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: "Accès refusé : rôle insuffisant." });
    }
    next();
  };
}

