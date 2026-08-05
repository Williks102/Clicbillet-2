// Doit s'importer avant tout le reste : Sentry.init() (si SENTRY_DSN est défini) installe ses
// gestionnaires globaux uncaughtException/unhandledRejection dès l'exécution de ce module.
import { setupSentryExpressErrorHandler } from "./server/lib/observability.js";

import express from "express";
import fs from "fs";
import path from "path";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { PORT, HMR_PORT, PAYMENT_GATEWAY_ORIGINS, SUPABASE_REALTIME_ORIGINS, isProduction } from "./server/lib/config.js";
import { apiGeneralRateLimiter } from "./server/lib/rateLimiters.js";
import { requireAuth, requireRole } from "./server/lib/auth.js";
import { sanitizeObject } from "./server/lib/security.js";
import { findPublicEventById, buildEventPreviewTags, injectPreviewTags } from "./server/lib/socialPreview.js";

import eventsRouter from "./server/routes/events.js";
import authRouter from "./server/routes/auth.js";
import ticketsRouter from "./server/routes/tickets.js";
import webhooksRouter from "./server/routes/webhooks.js";
import organizerRouter from "./server/routes/organizer.js";
import organizerRequestsRouter from "./server/routes/organizerRequests.js";
import adminRouter from "./server/routes/admin.js";

const app = express();

// Sur Vercel (et tout déploiement derrière un proxy/CDN), req.ip ne reflète l'IP réelle du
// client que si on fait confiance au premier hop de X-Forwarded-For posé par le edge Vercel.
// Sans ça, express-rate-limit verrait une seule IP pour tout le monde (le proxy) et bloquerait
// soit personne, soit tout le monde en même temps.
app.set("trust proxy", 1);

// Basic security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: isProduction
        ? ["'self'", "https://js.paystack.co"]
        : ["'self'", "'unsafe-inline'", "https://js.paystack.co"],
      connectSrc: ["'self'", `ws://127.0.0.1:${HMR_PORT}`, `ws://localhost:${HMR_PORT}`, ...PAYMENT_GATEWAY_ORIGINS, ...SUPABASE_REALTIME_ORIGINS],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      imgSrc: ["'self'", "https:", "data:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", ...PAYMENT_GATEWAY_ORIGINS],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'", ...PAYMENT_GATEWAY_ORIGINS],
      upgradeInsecureRequests: [],
    },
  },
  // Le SDK Paystack Inline est chargé en cross-origin sans header CORP ; le COEP par défaut
  // de helmet ("require-corp") le bloque silencieusement (NotSameOriginAfterDefaultedToSameOriginByCoep).
  crossOriginEmbedderPolicy: false,
}));

// Enable parsing middlewares for Webhooks and APIs
app.use(express.json({
  limit: "10mb",
  verify(req, res, buf) {
    (req as any).rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/api", apiGeneralRateLimiter);

// Défense CSRF en profondeur : la session vit désormais dans un cookie httpOnly, envoyé
// automatiquement par le navigateur avec TOUTE requête vers ce domaine — y compris une requête
// déclenchée par une page tierce malveillante (CSRF classique). SameSite=Lax sur le cookie
// lui-même (cf. server/lib/auth.ts) bloque déjà son envoi sur la plupart des requêtes
// cross-site non-GET, mais on ajoute une seconde barrière : exiger un en-tête personnalisé
// qu'un <form>/<img>/<script> posté depuis un autre site ne peut pas fixer (et qu'une requête
// fetch/XHR cross-origin ne peut pas fixer sans déclencher un preflight CORS, qui échoue ici
// puisqu'aucune politique CORS n'autorise d'origine tierce). Les webhooks (Paystack, Supabase)
// sont exemptés : ce sont des appels serveur-à-serveur authentifiés par signature, jamais par
// cookie de session.
app.use("/api", (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.originalUrl.startsWith("/api/webhooks/")) return next();
  if (req.headers["x-requested-with"] !== "ClicBillet") {
    return res.status(403).json({ error: "Requête refusée (en-tête de sécurité manquant)." });
  }
  next();
});

// Middleware d'assainissement automatique global (XSS, Injection)
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  next();
});

// Sécurisation des endpoints administrateurs et organisateurs
app.use("/api/admin", requireAuth, requireRole("admin"));
app.use("/api/organizer", requireAuth);

app.use(eventsRouter);
app.use(authRouter);
app.use(ticketsRouter);
app.use(webhooksRouter);
app.use(organizerRouter);
app.use(organizerRequestsRouter);
app.use(adminRouter);

// Doit être enregistré après tous les routers ci-dessus (et avant le middleware statique/SPA
// qui suit) : capture toute exception non interceptée levée dans une route pour la remonter
// à Sentry avant la réponse d'erreur générique. No-op si SENTRY_DSN n'est pas définie.
setupSentryExpressErrorHandler(app);

// Page d'un événement : c'est la SEULE route servie avec un HTML personnalisé, parce que
// c'est la seule destinée à être partagée dans une conversation. Les robots d'aperçu
// (WhatsApp, Facebook, X) n'exécutent pas le JavaScript : les balises Open Graph doivent être
// présentes dans le HTML livré, sinon un lien partagé n'affiche ni affiche ni titre.
//
// Le reste de l'application continue d'être servi tel quel : aucun rendu serveur ailleurs.
function registerEventPreviewRoute(app: express.Express, loadTemplate: () => Promise<string>) {
  app.get("/e/:id", async (req: express.Request, res: express.Response) => {
    try {
      const template = await loadTemplate();
      const event = await findPublicEventById(String(req.params.id || ""));

      // Événement inconnu, non approuvé, ou lecture impossible : on sert l'application
      // normale, sans aperçu. Le frontend affichera son propre message d'introuvable —
      // mieux vaut ça qu'une page d'erreur brute sur un lien partagé.
      if (!event) {
        return res.status(404).type("html").send(template);
      }

      res.type("html").send(injectPreviewTags(template, buildEventPreviewTags(event)));
    } catch (err: any) {
      console.error("[Aperçu de partage] Rendu de /e/:id impossible :", err.message);
      res.redirect(302, "/");
    }
  });
}

// Configure Vite middleware and static serving as requested
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        strictPort: false,
        hmr: {
          host: "127.0.0.1",
          port: HMR_PORT
        }
      },
      appType: "spa",
    });
    // Enregistrée AVANT le middleware Vite, qui répondrait sinon avec l'index.html brut.
    // transformIndexHtml applique les transformations de Vite (injection du client HMR,
    // réécriture des modules) pour que la page reste fonctionnelle en développement.
    registerEventPreviewRoute(app, async () => {
      const raw = await fs.promises.readFile(path.join(process.cwd(), "index.html"), "utf8");
      return vite.transformIndexHtml("/", raw);
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    registerEventPreviewRoute(app, () => fs.promises.readFile(path.join(distPath, "index.html"), "utf8"));
    app.use(express.static(distPath));
    app.get("*", (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!process.env.VERCEL) {
    await listenOnAvailablePort(PORT);
  } else {
    console.log("[Vercel] En cours d'exécution dans un environnement Serverless - app.listen ignoré.");
  }
}

async function listenOnAvailablePort(startPort: number) {
  const maxAttempts = 5;
  let port = startPort;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = app.listen(port, "0.0.0.0", () => {
          console.log(`ClicBillet server running on http://0.0.0.0:${port}`);
          resolve();
        });

        server.on("error", (err: any) => {
          reject(err);
        });
      });
      return;
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        console.warn(`Port ${port} occupé, tentative sur ${port + 1}...`);
        port += 1;
        continue;
      }
      console.error("Erreur de démarrage du serveur :", err);
      throw err;
    }
  }

  throw new Error(`Impossible d'écouter sur un port libre après ${maxAttempts} tentatives (début: ${startPort}).`);
}

startServer();

export default app;

