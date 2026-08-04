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

// Une instance dédiée par route : une même instance express-rate-limit partagée entre
// plusieurs routes compte les requêtes des DEUX routes dans le même compartiment par IP —
// quelques tentatives d'inscription (typos d'email) pouvaient ainsi faire bloquer
// prématurément un login légitime depuis la même IP, et inversement.
export const loginRateLimiter = makeRateLimiter(10, 15 * 60 * 1000, "Trop de tentatives de connexion. Réessayez dans quelques minutes.");
export const registerRateLimiter = makeRateLimiter(10, 15 * 60 * 1000, "Trop de tentatives d'inscription. Réessayez dans quelques minutes.");
export const resetPasswordRateLimiter = makeRateLimiter(10, 15 * 60 * 1000, "Trop de tentatives. Réessayez dans quelques minutes.");
export const mfaVerifyRateLimiter = makeRateLimiter(10, 15 * 60 * 1000, "Trop de tentatives de vérification. Réessayez dans quelques minutes.");
export const forgotPasswordRateLimiter = makeRateLimiter(5, 15 * 60 * 1000, "Trop de demandes de réinitialisation. Réessayez dans quelques minutes.");
export const checkoutRateLimiter = makeRateLimiter(20, 10 * 60 * 1000, "Trop de tentatives d'achat. Réessayez dans quelques minutes.");
export const apiGeneralRateLimiter = makeRateLimiter(300, 5 * 60 * 1000, "Trop de requêtes. Réessayez dans quelques instants.");
export const contactRateLimiter = makeRateLimiter(5, 15 * 60 * 1000, "Trop de messages envoyés. Réessayez dans quelques minutes.");

