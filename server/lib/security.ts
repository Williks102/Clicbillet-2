import crypto from "crypto";
import express from "express";
import { PAYMENT_PRO_CALLBACK_SECRET, PAYMENT_PRO_CALLBACK_ORIGIN, PAYMENT_WEBHOOK_SECRET } from "./config.js";

export function getPaymentSignature(req: express.Request): string | null {
  const headerValue = req.headers["x-paiementpro-signature"] || req.headers["x-signature"] || req.headers["x-webhook-signature"];
  if (!headerValue) return null;
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }
  return headerValue;
}

export function verifyPaymentSignature(req: express.Request): boolean {
  if (!PAYMENT_PRO_CALLBACK_SECRET) {
    console.warn("[Payment Callback] Clé de signature manquante : impossibilité de vérifier la signature du webhook.");
    return false;
  }

  const signature = getPaymentSignature(req);
  if (!signature) {
    return false;
  }

  const rawBody = (req as any).rawBody;
  const payload = rawBody ? rawBody.toString("utf8") : JSON.stringify(req.body || {});
  const expectedSignature = crypto.createHmac("sha256", PAYMENT_PRO_CALLBACK_SECRET)
    .update(payload)
    .digest("hex");

  const cleanedSignature = signature.replace(/^sha256=/i, "");
  try {
    return crypto.timingSafeEqual(Buffer.from(cleanedSignature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

export function corsAllowedOrigin(req: express.Request): string | undefined {
  const origin = (req.headers.origin || "").toString();
  if (!origin) return undefined;
  if (origin === PAYMENT_PRO_CALLBACK_ORIGIN) return origin;
  return undefined;
}

// PaiementPro concatène parfois ses propres paramètres (ex. "?merchantId=...") directement
// à la suite de notificationURL avec un "?" au lieu d'un "&", ce qui pollue la valeur du
// dernier paramètre de la query string existante. On applique la même normalisation que
// normalizeReferenceIdentifier() : tout ce qui suit un "?"/"&" supplémentaire est coupé.
export function normalizeWebhookSecretValue(value: string): string {
  return value.trim().split(/[?&]/)[0].trim();
}

export function getWebhookSecretFromRequest(req: express.Request): string | null {
  const querySecret = req.query.wh;
  if (typeof querySecret === "string") return normalizeWebhookSecretValue(querySecret);
  if (Array.isArray(querySecret)) return normalizeWebhookSecretValue(String(querySecret[0]));
  const bodySecret = req.body?.wh;
  if (typeof bodySecret === "string") return normalizeWebhookSecretValue(bodySecret);
  if (typeof bodySecret === "number") return String(bodySecret);
  return null;
}

// Le même serveur Express sert l'API et le frontend (SPA) sur la même origine : on peut donc
// dériver l'URL publique de l'app directement depuis la requête entrante, sans variable
// d'environnement dédiée (cf. buildWebhookNotificationUrl, même logique).
export function buildAppOrigin(req: express.Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const scheme = typeof forwardedProto === "string" ? forwardedProto : req.protocol;
  const host = req.get("host") || "localhost:3000";
  return (req.get("origin") || `${scheme}://${host}`).replace(/\/$/, "");
}

export function buildWebhookNotificationUrl(req: express.Request): string {
  const baseUrl = `${buildAppOrigin(req)}/api/payment/callback`;
  if (PAYMENT_WEBHOOK_SECRET) {
    return `${baseUrl}?wh=${encodeURIComponent(PAYMENT_WEBHOOK_SECRET)}`;
  }
  return baseUrl;
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

