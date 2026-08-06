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
// Domaine d'envoi encore distinct du domaine web. clicbillet.com était auparavant partagé avec
// une autre application (Laravel) ; ce n'est plus le cas — il ne dessert plus que cette app.
// Le repli reste néanmoins monticket.online tant que clicbillet.com n'est pas vérifié
// (SPF/DKIM) côté Resend : basculer l'expéditeur avant cette vérification ferait rejeter tous
// les emails transactionnels — billets, réinitialisation de mot de passe, notifications.
// Seul l'EXPÉDITEUR est concerné ; le destinataire (ADMIN_NOTIFICATION_EMAIL ci-dessous) peut
// être sur n'importe quel domaine.
export const RESEND_FROM_EMAIL = (process.env.RESEND_FROM_EMAIL || "ClicBillet <no-reply@monticket.online>").trim();
// ADMIN_EMAIL est accepté comme alias : c'est le nom réellement utilisé dans la configuration
// Vercel du projet. Sans cet alias, la variable définie là-bas était purement ignorée et
// TOUTES les notifications administratives (nouvel organisateur, demande de retrait, message
// de contact, demande d'accès organisateur) repartaient en silence vers l'adresse de repli
// ci-dessous — aucune erreur, aucun symptôme, juste des emails qui n'arrivent pas.
// Même principe que SUPABASE_URL / VITE_SUPABASE_URL plus haut.
const ADMIN_NOTIFICATION_EMAIL_FROM_ENV = (process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || "").trim();
export const ADMIN_NOTIFICATION_EMAIL = ADMIN_NOTIFICATION_EMAIL_FROM_ENV || "admin@monticket.online";

// isProduction n'est déclarée que plus bas dans ce fichier : on teste NODE_ENV directement,
// comme les autres contrôles de démarrage situés avant elle.
if (process.env.NODE_ENV === "production" && !ADMIN_NOTIFICATION_EMAIL_FROM_ENV) {
  console.warn(
    `[Config] Ni ADMIN_NOTIFICATION_EMAIL ni ADMIN_EMAIL ne sont définies : les notifications ` +
    `administratives partent vers l'adresse de repli "${ADMIN_NOTIFICATION_EMAIL}". Les demandes ` +
    `de retrait et les demandes d'accès organisateur y arriveront — vérifiez que cette boîte est relevée.`
  );
}
export const SUPABASE_WEBHOOK_SECRET = (process.env.SUPABASE_WEBHOOK_SECRET || "").trim();

// Secret injecté automatiquement par Vercel Cron dans le header Authorization ("Bearer <secret>")
// pour authentifier ses propres appels programmés — cf. /api/cron/expire-pending-tickets.
export const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

// Contrôle d'accès : bornes de la fenêtre pendant laquelle un billet est scannable.
//
// Sans borne haute, /api/verify-ticket validait un billet payé et non scanné indéfiniment —
// des mois après l'événement. Pour un organisateur récurrent, le billet de la semaine passée
// ouvrait la porte de la suivante.
//
// La borne haute est la fin de l'événement, plus cette marge : un événement déborde presque
// toujours un peu, et un retardataire ne doit pas être refusé pour dix minutes.
export const EVENT_SCAN_GRACE_HOURS = Number(process.env.EVENT_SCAN_GRACE_HOURS) || 3;

// Repli pour les événements créés avant l'introduction de la date de fin, qui n'en ont pas :
// la fenêtre se ferme alors ce nombre d'heures après le DÉBUT. Assez large pour couvrir une
// nuit entière, sans laisser un billet valide le lendemain.
export const EVENT_DEFAULT_DURATION_HOURS = Number(process.env.EVENT_DEFAULT_DURATION_HOURS) || 12;

// Délai au-delà duquel un billet resté "PENDING-" (paiement jamais confirmé ni explicitement
// échoué) est considéré abandonné et annulé automatiquement, libérant l'inventaire réservé.
export const PENDING_TICKET_EXPIRY_MINUTES = Number(process.env.PENDING_TICKET_EXPIRY_MINUTES) || 30;

// Politique de rétention des données : au-delà de ce délai, un panier abandonné/échoué
// ("EXPIRED-"/"FAILED-", jamais payé) est définitivement supprimé plutôt que conservé
// indéfiniment — aucune valeur financière ou légale (contrairement à un billet payé ou une
// transaction réussie, jamais touchés par cette purge), seulement du PII acheteur (nom, email)
// qui traîne sans raison une fois le délai passé. Cf. /api/cron/expire-pending-tickets.
export const ABANDONED_TICKET_RETENTION_DAYS = Number(process.env.ABANDONED_TICKET_RETENTION_DAYS) || 90;

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

// Clé de chiffrement des coordonnées de retrait des organisateurs (payouts.details : numéro
// mobile money / IBAN, cf. server/lib/payoutEncryption.ts) : une donnée financière sensible qui
// ne doit jamais être lisible en clair dans la base (Supabase ou db.json), y compris par un
// éventuel accès direct à la base contournant l'application. Clé AES-256 attendue en hex (64
// caractères) ou base64 dans PAYOUT_DETAILS_ENCRYPTION_KEY.
function loadPayoutDetailsEncryptionKey(): Buffer {
  const raw = (process.env.PAYOUT_DETAILS_ENCRYPTION_KEY || "").trim();
  if (raw) {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (buf.length !== 32) {
      console.error("[Security] PAYOUT_DETAILS_ENCRYPTION_KEY doit représenter exactement 32 octets (64 caractères hex, ou l'équivalent en base64).");
      process.exit(1);
    }
    return buf;
  }
  if (process.env.NODE_ENV === "production") {
    console.error("[Security] PAYOUT_DETAILS_ENCRYPTION_KEY manquante en production : impossible de chiffrer les coordonnées de retrait (mobile money / IBAN) des organisateurs. Arrêt du serveur.");
    process.exit(1);
  }
  // Dev uniquement : clé éphémère régénérée à chaque démarrage, même principe que
  // LOCAL_*_PASSWORD ci-dessous — les retraits chiffrés avant un redémarrage local ne seront
  // alors plus déchiffrables, sans conséquence puisqu'il s'agit de données db.json locales.
  console.warn("[Payouts] PAYOUT_DETAILS_ENCRYPTION_KEY absente : clé de chiffrement éphémère générée pour ce process (développement uniquement).");
  return crypto.randomBytes(32);
}

export const PAYOUT_DETAILS_ENCRYPTION_KEY = loadPayoutDetailsEncryptionKey();

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

// Origine canonique de l'application, utilisée pour construire des URL sensibles (lien de
// réinitialisation de mot de passe) — jamais dérivée des en-têtes Host/Origin de la requête,
// entièrement contrôlables par l'appelant (un attaquant peut les usurper sans passer par le
// vrai frontend), ce qui permettrait sinon de faire pointer un email de réinitialisation
// légitime vers un domaine de phishing tout en gardant un jeton valide.
//
// Sert désormais aussi à construire les URL des aperçus de partage (og:url, og:image — cf.
// server/lib/socialPreview.ts) : mal renseignée, elle ne casse plus seulement les emails, elle
// fait pointer chaque lien partagé sur WhatsApp vers le mauvais domaine.
//
// La barre finale éventuelle est retirée : "https://site.ci/" produirait sinon des URL en
// double barre ("https://site.ci//e/evt-1"), que certains robots d'aperçu refusent.
// Domaine canonique retenu pour la plateforme : https://www.clicbillet.com. C'est aussi le
// repli en production, de sorte qu'une variable oubliée donne quand même la bonne origine —
// mais la définir explicitement reste préférable (cf. .env.example), le repli n'ayant aucun
// moyen de suivre un changement de domaine.
const CANONICAL_PRODUCTION_ORIGIN = "https://www.clicbillet.com";

const APP_ORIGIN_FROM_ENV = (process.env.APP_ORIGIN || "").trim();
const APP_ORIGIN_FALLBACK = isProduction ? CANONICAL_PRODUCTION_ORIGIN : `http://localhost:${PORT}`;

// Raison pour laquelle une valeur ne peut pas produire de lien cliquable, ou null si elle convient.
// L'espace mérite son propre test, avant même l'analyse d'URL : "https://pas www.clicbillet.com"
// s'analyse sans erreur (le nom d'hôte devient "pas%20www.clicbillet.com" une fois encodé par le
// client mail), et le destinataire tombe sur un domaine inexistant. C'est arrivé en production
// sur les liens de réinitialisation de mot de passe.
function appOriginRejection(value: string): string | null {
  if (/\s/.test(value)) return "elle contient une espace";

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "ce n'est pas une URL valide (le schéma https:// est-il présent ?)";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `le schéma "${parsed.protocol}" ne produit pas un lien web`;
  }
  if (isProduction && parsed.protocol !== "https:") return "elle doit être en https en production";
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return "elle doit être une origine seule, sans chemin ni paramètre";
  return null;
}

// Diagnostic au démarrage : une origine erronée est silencieuse — rien ne casse visiblement,
// mais les liens de réinitialisation de mot de passe, les redirections de confirmation
// d'email et les aperçus de partage pointent tous vers un domaine qui n'est pas le vôtre.
// Mieux vaut le dire au démarrage que le découvrir sur un lien envoyé à un client.
// Volontairement en warn et non en error : le repli vaut le domaine canonique, donc une
// variable non définie donne quand même la bonne origine. Un console.error partirait à chaque
// démarrage vers Sentry (captureConsoleIntegration, cf. server/lib/observability.ts) pour une
// situation qui fonctionne — exactement le genre d'alerte non actionnable qui noie les vraies.
if (isProduction && !APP_ORIGIN_FROM_ENV) {
  console.warn(
    `[Config] APP_ORIGIN n'est pas définie : repli sur le domaine canonique "${APP_ORIGIN_FALLBACK}". ` +
    `Définissez-la explicitement si le domaine servi change, sans quoi les liens de ` +
    `réinitialisation de mot de passe, les confirmations d'email et les aperçus de partage ` +
    `continueront de pointer vers ce domaine.`
  );
}

// Une valeur inexploitable est ÉCARTÉE, et non seulement signalée : la version précédente
// journalisait « les liens générés seront inutilisables » puis s'en servait quand même, si bien
// qu'un e-mail de réinitialisation partait malgré tout avec une adresse morte. Le repli sur le
// domaine canonique laisse au moins l'utilisateur atteindre le site ; l'erreur reste bruyante
// (donc visible dans Sentry) pour que la variable soit corrigée.
const APP_ORIGIN_REJECTION = APP_ORIGIN_FROM_ENV ? appOriginRejection(APP_ORIGIN_FROM_ENV) : null;
if (APP_ORIGIN_REJECTION) {
  console.error(
    `[Config] APP_ORIGIN inutilisable : "${APP_ORIGIN_FROM_ENV}" — ${APP_ORIGIN_REJECTION}. ` +
    `Repli sur "${APP_ORIGIN_FALLBACK}". Corrigez la variable d'environnement : elle doit valoir ` +
    `exactement l'origine du site, par exemple "${CANONICAL_PRODUCTION_ORIGIN}".`
  );
}

export const APP_ORIGIN = (APP_ORIGIN_REJECTION || !APP_ORIGIN_FROM_ENV ? APP_ORIGIN_FALLBACK : APP_ORIGIN_FROM_ENV)
  .replace(/\/+$/, "");

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

