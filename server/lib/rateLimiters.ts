import rateLimit from "express-rate-limit";
import express from "express";
import { isSupabaseEnabled, supabase } from "./config.js";

export function makeRateLimiter(max: number, windowMs: number, message: string) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: express.Request, res: express.Response) => {
      res.status(429).json({ error: message });
    }
  });
}

// Limiteur à COMPTEUR PARTAGÉ, adossé à Postgres (cf. supabase_setup.sql section 24).
//
// express-rate-limit compte en mémoire du processus. En serverless, chaque instance a la
// sienne : sous un pic, Vercel en lance des dizaines et une limite de 10 tentatives de
// connexion par IP en devient 10 PAR INSTANCE. La protection s'évapore donc exactement au
// moment où elle sert — une force brute n'a qu'à ouvrir assez de connexions simultanées pour
// que chacune tombe sur une instance neuve.
//
// Deux partis pris :
//
//   - EN CAS D'ERREUR, ON LAISSE PASSER. Un limiteur qui refuse tout parce que la base
//     hoquette transformerait un incident mineur en panne totale du site. Le risque inverse
//     — quelques requêtes non comptées pendant l'incident — est sans commune mesure.
//
//   - RÉSERVÉ AUX ROUTES SENSIBLES. Chaque vérification coûte un aller-retour base ; l'imposer
//     à TOUTES les requêtes d'API alourdirait précisément ce qu'on cherche à protéger. Le
//     limiteur général reste donc en mémoire : son rôle est d'absorber le bruit de fond, pas
//     d'arrêter une attaque ciblée.
export function makeSharedRateLimiter(name: string, max: number, windowMs: number, message: string) {
  const memoire = makeRateLimiter(max, windowMs, message);
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));

  return async function limiteur(req: express.Request, res: express.Response, next: express.NextFunction) {
    // Sans Supabase (développement local sur db.json), le compteur mémoire fait l'affaire :
    // il n'y a alors qu'un seul processus, la fragmentation n'existe pas.
    if (!isSupabaseEnabled || !supabase) return memoire(req, res, next);

    // req.ip tient compte de "trust proxy" (cf. server.ts) : c'est bien l'adresse du client,
    // pas celle du réseau de diffusion qui a relayé la requête.
    const cle = `${name}:${req.ip || "inconnue"}`;

    try {
      const { data, error } = await supabase.rpc("rate_limit_check", {
        p_key: cle,
        p_max: max,
        p_window_seconds: windowSeconds,
      });
      if (error) throw error;

      const ligne = Array.isArray(data) ? data[0] : data;
      if (!ligne) return next();

      const hits = Number(ligne.hits) || 0;
      res.set("RateLimit-Limit", String(max));
      res.set("RateLimit-Remaining", String(Math.max(0, max - hits)));
      if (ligne.reset_at) {
        res.set("RateLimit-Reset", String(Math.max(0, Math.round((new Date(ligne.reset_at).getTime() - Date.now()) / 1000))));
      }

      if (ligne.allowed === false) {
        return res.status(429).json({ error: message });
      }
      return next();
    } catch (err: any) {
      console.warn(`[RateLimit] Comptage partagé indisponible pour "${name}" (${err?.message}) : requête laissée passer.`);
      return next();
    }
  };
}

// Une instance dédiée par route : une même instance express-rate-limit partagée entre
// plusieurs routes compte les requêtes des DEUX routes dans le même compartiment par IP —
// quelques tentatives d'inscription (typos d'email) pouvaient ainsi faire bloquer
// prématurément un login légitime depuis la même IP, et inversement.
export const loginRateLimiter = makeSharedRateLimiter("login", 10, 15 * 60 * 1000, "Trop de tentatives de connexion. Réessayez dans quelques minutes.");
export const registerRateLimiter = makeSharedRateLimiter("register", 10, 15 * 60 * 1000, "Trop de tentatives d'inscription. Réessayez dans quelques minutes.");
export const resetPasswordRateLimiter = makeSharedRateLimiter("reset-password", 10, 15 * 60 * 1000, "Trop de tentatives. Réessayez dans quelques minutes.");
export const mfaVerifyRateLimiter = makeSharedRateLimiter("mfa-verify", 10, 15 * 60 * 1000, "Trop de tentatives de vérification. Réessayez dans quelques minutes.");
export const forgotPasswordRateLimiter = makeSharedRateLimiter("forgot-password", 5, 15 * 60 * 1000, "Trop de demandes de réinitialisation. Réessayez dans quelques minutes.");
export const resendConfirmationRateLimiter = makeSharedRateLimiter("resend-confirmation", 5, 15 * 60 * 1000, "Trop de renvois demandés. Réessayez dans quelques minutes.");
export const checkoutRateLimiter = makeSharedRateLimiter("checkout", 20, 10 * 60 * 1000, "Trop de tentatives d'achat. Réessayez dans quelques minutes.");
export const contactRateLimiter = makeSharedRateLimiter("contact", 5, 15 * 60 * 1000, "Trop de messages envoyés. Réessayez dans quelques minutes.");
export const transferTicketRateLimiter = makeSharedRateLimiter("transfer-ticket", 10, 15 * 60 * 1000, "Trop de transferts de billets. Réessayez dans quelques minutes.");
export const organizerRequestRateLimiter = makeSharedRateLimiter("organizer-request", 5, 60 * 60 * 1000, "Trop de demandes envoyées. Réessayez dans une heure.");

// Volontairement laissé en mémoire : il s'applique à TOUTES les requêtes d'API, y compris la
// consultation du catalogue. Un aller-retour base sur chacune coûterait plus cher que ce qu'il
// protège — et les routes qui méritent vraiment d'être défendues ont leur limiteur partagé
// ci-dessus. Son plafond, volontairement haut, ne vise que le bruit de fond.
export const apiGeneralRateLimiter = makeRateLimiter(300, 5 * 60 * 1000, "Trop de requêtes. Réessayez dans quelques instants.");
