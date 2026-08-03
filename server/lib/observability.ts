import * as Sentry from "@sentry/node";
import { isProduction } from "./config.js";

// Les logs applicatifs (console.error, une cinquantaine d'appels répartis dans server/) ne
// vivaient jusqu'ici que dans les logs éphémères de Vercel (rétention limitée, pas de
// recherche/alerte). Sentry capture automatiquement CES MÊMES appels console.error existants
// via captureConsoleIntegration ci-dessous : aucun site d'appel n'a besoin d'être modifié.
// Optionnel par conception (comme RESEND_API_KEY, SUPABASE_WEBHOOK_SECRET, etc.) : sans
// SENTRY_DSN, l'app fonctionne normalement, seulement sans persistance au-delà des logs Vercel.
const SENTRY_DSN = (process.env.SENTRY_DSN || "").trim();
export const isSentryEnabled = Boolean(SENTRY_DSN);

if (isSentryEnabled) {
  // Pas de tracesSampleRate : on ne vise que la capture d'erreurs persistante ici, pas le
  // traçage de performance (qui nécessiterait une auto-instrumentation Express fiable,
  // difficile à garantir avec ce mode d'exécution ESM via tsx/esbuild plutôt qu'un --import
  // Node classique).
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: isProduction ? "production" : "development",
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
} else if (isProduction) {
  console.warn("[Observability] SENTRY_DSN absente : les erreurs serveur ne sont visibles que dans les logs Vercel (rétention limitée), sans agrégation ni alerte persistante.");
}

// Enregistre le middleware d'erreur Sentry sur l'app Express : doit être appelé après tous
// les routers (server.ts), pour que les exceptions non interceptées dans une route soient
// bien remontées avant la réponse d'erreur générique.
export function setupSentryExpressErrorHandler(app: { use: (middleware: unknown) => unknown }) {
  if (isSentryEnabled) Sentry.setupExpressErrorHandler(app);
}
