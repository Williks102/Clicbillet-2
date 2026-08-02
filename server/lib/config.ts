import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Charge .env avant toute lecture de process.env ci-dessous (et avant tout autre module
// lib/route qui importerait ce fichier) : c'est l'unique point d'entrée dotenv.config()
// du backend, remplace l'appel qui vivait auparavant en tête de server.ts.
dotenv.config();

export const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
export const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
export const PAYSTACK_SECRET_KEY = (process.env.PAYSTACK_SECRET_KEY || "").trim();
// Paystack n'autorise qu'UNE SEULE URL de webhook par compte marchand (limitation Paystack,
// pas la nôtre) — ce compte étant partagé avec une autre application, tout événement dont la
// référence n'utilise pas notre préfixe "ORD-" est relayé tel quel vers cette URL plutôt que
// traité ou perdu (cf. server/routes/tickets.ts, /api/webhooks/paystack).
export const PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL = (process.env.PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL || "").trim();
export const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
// Domaine d'envoi/réception distinct du domaine web (clicbillet.com, sans www, appartient à
// une autre application (Laravel) — pas celle-ci) : on garde monticket.online ici tant que
// clicbillet.com n'est pas vérifié (SPF/DKIM) côté Resend, pour ne pas casser l'envoi d'emails.
export const RESEND_FROM_EMAIL = (process.env.RESEND_FROM_EMAIL || "ClicBillet <no-reply@monticket.online>").trim();
export const ADMIN_NOTIFICATION_EMAIL = (process.env.ADMIN_NOTIFICATION_EMAIL || "admin@monticket.online").trim();
export const SUPABASE_WEBHOOK_SECRET = (process.env.SUPABASE_WEBHOOK_SECRET || "").trim();

// Secret injecté automatiquement par Vercel Cron dans le header Authorization ("Bearer <secret>")
// pour authentifier ses propres appels programmés — cf. /api/cron/expire-pending-tickets.
export const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

// Délai au-delà duquel un billet resté "PENDING-" (paiement jamais confirmé ni explicitement
// échoué) est considéré abandonné et annulé automatiquement, libérant l'inventaire réservé.
export const PENDING_TICKET_EXPIRY_MINUTES = Number(process.env.PENDING_TICKET_EXPIRY_MINUTES) || 30;

// Le serveur n'utilise que la clé service_role pour toutes les écritures/lectures sensibles,
// protégées par requireAuth/requireRole côté Express. Le frontend possède néanmoins SON PROPRE
// client Supabase, à clé anon uniquement (src/lib/supabaseClient.ts), utilisé pour deux lectures
// publiques bornées par RLS : l'abonnement Realtime à ses propres tickets, et la lecture directe
// du catalogue d'événements approuvés (src/lib/publicEvents.ts), pour éviter le cold-start
// serverless sur ces deux chemins très visités. Ce module (config.ts) ne gère que le client
// côté serveur.
const useSupabaseAdmin = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
export const supabaseAdmin = useSupabaseAdmin ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;
export const supabase = supabaseAdmin;
export const isSupabaseEnabled = Boolean(supabase);

export function createEphemeralAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// Régénérés aléatoirement à CHAQUE démarrage du process si non définis en variable
// d'environnement : un redémarrage du serveur local invalide le mot de passe précédemment
// loggué. Définissez LOCAL_*_PASSWORD dans .env si vous voulez un mot de passe stable entre
// redémarrages.
export const LOCAL_ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || crypto.randomBytes(12).toString("hex");
export const LOCAL_CLIENT_PASSWORD = process.env.LOCAL_CLIENT_PASSWORD || crypto.randomBytes(12).toString("hex");
export const LOCAL_ORGANIZER_PASSWORD = process.env.LOCAL_ORGANIZER_PASSWORD || crypto.randomBytes(12).toString("hex");

if (process.env.NODE_ENV !== "production") {
  console.info("[Dev login] Local fallback passwords are available only in development mode:");
  console.info(`  admin: ${LOCAL_ADMIN_PASSWORD}`);
  console.info(`  client: ${LOCAL_CLIENT_PASSWORD}`);
  console.info(`  organizer: ${LOCAL_ORGANIZER_PASSWORD}`);
}

if (!isSupabaseEnabled) {
  console.warn("[Supabase Warning] Configuration Supabase incomplète (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquante). Le backend bascule vers db.json en local.");
}

if (!isSupabaseEnabled && process.env.NODE_ENV === "production") {
  console.error("[Security] Aucune connexion Supabase valide détectée en production. Arrêt du serveur : le repli db.json ne doit jamais servir de base en production.");
  process.exit(1);
}

export const PORT = Number(process.env.PORT) || 3000;
export const HMR_PORT = Number(process.env.HMR_PORT || process.env.WS_PORT) || 24678;

// Domaines Paystack : js.paystack.co sert le SDK Inline, api.paystack.co reçoit les appels
// XHR du popup, checkout.paystack.com/standard.paystack.co hébergent l'iframe affichée pour
// la saisie carte/OTP/3-D Secure pendant la transaction. Seul www.clicbillet.com (pas l'apex
// clicbillet.com, qui appartient à une autre application) est le domaine de ce projet.
export const PAYMENT_GATEWAY_ORIGINS = [
  "https://www.clicbillet.com",
  "https://js.paystack.co",
  "https://api.paystack.co",
  "https://checkout.paystack.com",
  "https://standard.paystack.co",
];

export const isProduction = process.env.NODE_ENV === "production";

export const SUPABASE_HOST = (() => {
  try {
    return SUPABASE_URL ? new URL(SUPABASE_URL).host : "";
  } catch {
    return "";
  }
})();
export const SUPABASE_REALTIME_ORIGINS = SUPABASE_HOST
  ? [`https://${SUPABASE_HOST}`, `wss://${SUPABASE_HOST}`]
  : [];

