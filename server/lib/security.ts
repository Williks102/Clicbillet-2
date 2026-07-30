import crypto from "crypto";
import express from "express";
import { PAYSTACK_SECRET_KEY } from "./config.js";

// Paystack signe chaque événement webhook avec un HMAC-SHA512 du corps brut de la requête,
// calculé avec la clé secrète du compte (cf. https://paystack.com/docs/payments/webhooks/).
// Contrairement à PaiementPro (qui n'émettait aucune signature), cette vérification est une
// vraie barrière cryptographique : un événement dont la signature ne correspond pas doit être
// rejeté sans être traité.
export function verifyPaystackSignature(req: express.Request): boolean {
  if (!PAYSTACK_SECRET_KEY) {
    console.warn("[Paystack Webhook] PAYSTACK_SECRET_KEY manquant : impossible de vérifier la signature.");
    return false;
  }

  const signature = req.headers["x-paystack-signature"];
  if (!signature || Array.isArray(signature)) {
    return false;
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) return false;

  const expectedSignature = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

// Le même serveur Express sert l'API et le frontend (SPA) sur la même origine : on peut donc
// dériver l'URL publique de l'app directement depuis la requête entrante, sans variable
// d'environnement dédiée.
export function buildAppOrigin(req: express.Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const scheme = typeof forwardedProto === "string" ? forwardedProto : req.protocol;
  const host = req.get("host") || "localhost:3000";
  return (req.get("origin") || `${scheme}://${host}`).replace(/\/$/, "");
}

/**
 * UTILS DE SÉCURITÉ ET D'ASSAINISSEMENT DES ENTRÉES
 * Protège les points de terminaison de l'API contre les failles d'injection (SQL, XSS, etc.)
 */

export function sanitizeString(val: string): string {
  if (!val) return "";
  let s = val.trim();
  // Neutralise les balises HTML ou scripts pour éviter l'exécution XSS
  s = s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Bloque les gestionnaires d'événements JavaScript actifs suspects
  s = s.replace(/(javascript:|onload|onerror|onclick|onmouseover|onfocus|onkeydown|script)/gi, "[REDACTED_EVENT_HANDLER]");
  return s;
}

export function sanitizeObject(obj: any): any {
  if (typeof obj === "string") {
    return sanitizeString(obj);
  } else if (Array.isArray(obj)) {
    return obj.map((item: any) => sanitizeObject(item));
  } else if (obj !== null && typeof obj === "object") {
    const cleanObj: any = {};
    for (const key of Object.keys(obj)) {
      cleanObj[key] = sanitizeObject(obj[key]);
    }
    return cleanObj;
  }
  return obj;
}

