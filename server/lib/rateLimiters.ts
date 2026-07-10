import rateLimit from "express-rate-limit";
import express from "express";

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

export const loginRateLimiter = makeRateLimiter(10, 15 * 60 * 1000, "Trop de tentatives de connexion. Réessayez dans quelques minutes.");
export const forgotPasswordRateLimiter = makeRateLimiter(5, 15 * 60 * 1000, "Trop de demandes de réinitialisation. Réessayez dans quelques minutes.");
export const checkoutRateLimiter = makeRateLimiter(20, 10 * 60 * 1000, "Trop de tentatives d'achat. Réessayez dans quelques minutes.");
export const apiGeneralRateLimiter = makeRateLimiter(300, 5 * 60 * 1000, "Trop de requêtes. Réessayez dans quelques instants.");
// Vote gratuit : large marge pour un usage légitime multi-candidats/multi-campagnes depuis
// un même réseau (wifi public, cybercafé), tout en bornant le bourrage d'urnes scripté.
export const voteFreeRateLimiter = makeRateLimiter(30, 10 * 60 * 1000, "Trop de votes depuis cette connexion. Réessayez dans quelques minutes.");

