import express from "express";
import path from "path";
import helmet from "helmet";

import { PORT, HMR_PORT, PAYMENT_GATEWAY_ORIGINS, SUPABASE_REALTIME_ORIGINS, isProduction } from "./server/lib/config";
import { apiGeneralRateLimiter } from "./server/lib/rateLimiters";
import { requireAuth, requireRole } from "./server/lib/auth";
import { sanitizeObject } from "./server/lib/security";

import eventsRouter from "./server/routes/events";
import authRouter from "./server/routes/auth";
import ticketsRouter from "./server/routes/tickets";
import webhooksRouter from "./server/routes/webhooks";
import organizerRouter from "./server/routes/organizer";
import adminRouter from "./server/routes/admin";

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
        ? ["'self'", "https://paiementpro.net"]
        : ["'self'", "'unsafe-inline'", "https://paiementpro.net"],
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
  // Le SDK Paiement Pro est chargé en cross-origin sans header CORP ; le COEP par défaut
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
app.use("/api", apiGeneralRateLimiter);

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
app.use(adminRouter);

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
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
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

