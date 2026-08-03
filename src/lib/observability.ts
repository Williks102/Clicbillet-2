import * as Sentry from "@sentry/react";

// Optionnel par conception (comme VITE_SUPABASE_URL, etc.) : sans VITE_SENTRY_DSN, l'app
// fonctionne normalement, seulement sans remontée persistante des crashs React côté client
// (cf. ErrorBoundary.tsx, qui se contentait jusqu'ici d'un console.error).
const SENTRY_DSN = (import.meta.env.VITE_SENTRY_DSN || "").trim();
export const isSentryEnabled = Boolean(SENTRY_DSN);

if (isSentryEnabled) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.PROD ? "production" : "development",
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}
