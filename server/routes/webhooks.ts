import express from "express";
import { SUPABASE_WEBHOOK_SECRET } from "../lib/config";
import { extractBearerToken } from "../lib/auth";
import { runInBackground } from "../lib/utils";
import { sendWelcomeEmail, sendAdminNewOrganizerEmail } from "../lib/email";

const router = express.Router();

// Webhook Supabase Database Webhook : déclenché sur INSERT dans public.users,
// envoie l'email de bienvenue (+ notification admin si organisateur).
// Sécurisé par un secret partagé transmis via le header Authorization, configuré
// côté Supabase (Dashboard > Database > Webhooks) en plus de l'en-tête HTTP.
router.post("/api/webhooks/supabase/new-user", async (req: express.Request, res: express.Response) => {
  if (!SUPABASE_WEBHOOK_SECRET) {
    console.error("[Supabase Webhook] SUPABASE_WEBHOOK_SECRET non configuré.");
    return res.status(500).json({ status: "error", message: "Webhook secret manquant." });
  }

  const token = extractBearerToken(req);
  if (token !== SUPABASE_WEBHOOK_SECRET) {
    console.warn("[Supabase Webhook] Tentative rejetée : secret absent ou invalide.");
    return res.status(401).json({ status: "error", message: "Non autorisé." });
  }

  const { type, table, record } = req.body || {};

  if (type !== "INSERT" || table !== "users" || !record) {
    return res.status(200).json({ status: "ignored" });
  }

  runInBackground(sendWelcomeEmail({ email: record.email, name: record.name, role: record.role }));
  if (record.role === "organizer") {
    runInBackground(sendAdminNewOrganizerEmail({ name: record.name, email: record.email }));
  }

  res.status(200).json({ status: "success" });
});

export default router;

