// Confirmation d'un paiement, après le passage de commande.
//
// Deux chemins mènent au même résultat et peuvent se produire dans n'importe quel ordre : le
// webhook Paystack (serveur à serveur, fait autorité) et la vérification déclenchée par le
// navigateur au retour du paiement. confirmPaymentForTickets étant idempotent, les deux
// peuvent s'exécuter sans double confirmation ni double e-mail.
import express from "express";
import { verifyPaystackSignature } from "../lib/security.js";
import { checkoutRateLimiter } from "../lib/rateLimiters.js";
import { normalizeReferenceIdentifier, findTicketsByReference, confirmPaymentForTickets, notifyPaymentFailedForTickets } from "../lib/paymentConfirmation.js";
import { PAYSTACK_SECRET_KEY, PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL } from "../lib/config.js";

const PAYSTACK_API_BASE = "https://api.paystack.co";

const router = express.Router();

// Relaie tel quel (corps brut + signature d'origine) un événement Paystack qui n'appartient
// pas à ClicBillet vers l'application qui partage le même compte marchand — la signature
// HMAC-SHA512 reste valide côté destinataire puisqu'elle porte sur ce même corps brut avec la
// même clé secrète Paystack, donc son propre vérificateur de webhook fonctionne sans changement.
async function relayForeignPaystackEvent(req: express.Request): Promise<boolean> {
  if (!PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL) {
    console.warn("[Paystack Webhook] Événement d'une autre application reçu mais PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL non configuré — ignoré.");
    return false;
  }
  try {
    const signature = req.headers["x-paystack-signature"];
    const relayRes = await fetch(PAYSTACK_FOREIGN_WEBHOOK_FORWARD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "x-paystack-signature": String(signature) } : {})
      },
      body: (req as any).rawBody ?? JSON.stringify(req.body || {})
    });
    return relayRes.ok;
  } catch (err: any) {
    console.error("[Paystack Webhook] Échec du relais vers l'autre application:", err.message);
    return false;
  }
}

// Webhook Paystack : appelé serveur-à-serveur (pas de préflight CORS nécessaire), l'URL est
// configurée une seule fois dans le Dashboard Paystack (Settings > API Keys & Webhooks), pas
// par requête comme l'était notificationURL sous PaiementPro. La signature x-paystack-signature
// (HMAC-SHA512 du corps brut avec la clé secrète) est une vraie barrière cryptographique —
// contrairement à PaiementPro, Paystack signe réellement chaque événement.
router.post("/api/webhooks/paystack", async (req: express.Request, res: express.Response) => {
  if (!verifyPaystackSignature(req)) {
    console.error("[Paystack Webhook] Signature invalide ou absente.");
    return res.status(401).json({ status: "error", message: "Signature invalide." });
  }

  const { event, data } = req.body || {};
  const rawReference = data?.reference ? String(data.reference) : null;

  // Un seul webhook Paystack est configurable par compte marchand (limitation Paystack) : ce
  // compte est partagé avec une autre application dont les références n'utilisent jamais notre
  // préfixe "ORD-". On relaie donc tout événement qui n'est pas le nôtre plutôt que de le
  // traiter ou de le perdre silencieusement.
  if (rawReference && !rawReference.startsWith("ORD-")) {
    const relayed = await relayForeignPaystackEvent(req);
    return res.status(relayed ? 200 : 502).json({ status: relayed ? "success" : "error" });
  }

  const reference = rawReference ? normalizeReferenceIdentifier(rawReference) : null;

  if (!reference) {
    console.warn(`[Paystack Webhook] Événement "${event}" reçu sans référence exploitable.`);
    return res.status(200).json({ status: "success" });
  }

  console.log(`[Paystack Webhook] Événement "${event}" reçu pour la référence ${reference}.`);

  const resolvedTickets = await findTicketsByReference([reference]);
  if (resolvedTickets.length === 0) {
    console.warn(`[Paystack Webhook] Aucun billet trouvé pour la référence : ${reference}`);
    return res.status(200).json({ status: "success" });
  }

  if (event === "charge.success") {
    const confirmedCount = await confirmPaymentForTickets(resolvedTickets);
    console.log(`[Paystack Webhook] ${confirmedCount}/${resolvedTickets.length} billet(s) confirmé(s) pour la référence ${reference}.`);
  } else if (event === "charge.failed") {
    await notifyPaymentFailedForTickets(resolvedTickets);
  }

  res.status(200).json({ status: "success" });
});

// Vérification instantanée côté client : appelée juste après que le popup Paystack Inline
// ait renvoyé sa callback (response.reference), pour confirmer le billet sans attendre la
// latence du webhook. Ne fait confiance à rien venant du navigateur : re-interroge l'API
// Paystack (Verify Transaction) avec la clé secrète, seule source de vérité fiable. Le webhook
// ci-dessus reste la confirmation faisant autorité si l'utilisateur ferme l'onglet avant que
// cet appel n'aboutisse — confirmPaymentForTickets est idempotent, donc les deux peuvent
// s'exécuter sans double confirmation ni double email.
router.post("/api/payment/verify", checkoutRateLimiter, async (req: express.Request, res: express.Response) => {
  const { reference: rawReference } = req.body as { reference?: string };
  const reference = normalizeReferenceIdentifier(rawReference);
  if (!reference) {
    return res.status(400).json({ error: "reference requise." });
  }
  if (!PAYSTACK_SECRET_KEY) {
    console.error("[Paystack Verify] PAYSTACK_SECRET_KEY non configuré.");
    return res.status(500).json({ error: "Vérification de paiement indisponible." });
  }

  let paystackStatus: string;
  try {
    const verifyRes = await fetch(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const body: any = await verifyRes.json();
    if (!verifyRes.ok || !body?.status) {
      console.error("[Paystack Verify] Réponse invalide de l'API Paystack:", body);
      return res.status(502).json({ error: "Impossible de vérifier la transaction auprès de Paystack." });
    }
    paystackStatus = body.data?.status;
  } catch (err: any) {
    console.error("[Paystack Verify] Erreur réseau:", err.message);
    return res.status(502).json({ error: "Erreur réseau lors de la vérification du paiement." });
  }

  const resolvedTickets = await findTicketsByReference([reference]);
  if (resolvedTickets.length === 0) {
    return res.status(404).json({ error: "Commande introuvable pour cette référence." });
  }

  if (paystackStatus === "success") {
    const confirmedCount = await confirmPaymentForTickets(resolvedTickets);
    console.log(`[Paystack Verify] ${confirmedCount}/${resolvedTickets.length} billet(s) confirmé(s) pour la référence ${reference}.`);
    return res.json({ success: true, status: "success" });
  }

  if (paystackStatus === "failed") {
    await notifyPaymentFailedForTickets(resolvedTickets);
  }

  res.json({ success: false, status: paystackStatus });
});

router.post("/api/dev/simulate-payment", async (req: express.Request, res: express.Response) => {
  // Garde redondante : NODE_ENV n'est jamais défini explicitement en développement local
  // (`npm run dev` ne fait que `tsx server.ts`, sans variable d'environnement), donc un
  // blocklist strict sur NODE_ENV === "development" casserait le développement local. Sur
  // Vercel en revanche, VERCEL_ENV est injecté automatiquement par la plateforme elle-même
  // ("production" / "preview" / "development") — jamais absent, jamais mal orthographié par
  // erreur humaine, contrairement à NODE_ENV. On ferme donc la route dès que VERCEL_ENV existe
  // et n'est pas "development", quelle que soit la valeur (ou l'absence) de NODE_ENV — ce qui
  // couvre le cas d'une preview/production Vercel où NODE_ENV n'aurait pas été positionné à
  // "production" comme attendu.
  const isNonDevVercelDeployment = Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== "development";
  if (isNonDevVercelDeployment || process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Route disponible uniquement en développement." });
  }

  const { referenceNumber } = req.body;
  if (!referenceNumber) {
    return res.status(400).json({ error: "referenceNumber requis pour la simulation." });
  }

  const rawReferenceNumber = normalizeReferenceIdentifier(referenceNumber);
  if (!rawReferenceNumber) {
    return res.status(400).json({ error: "Référence invalide." });
  }

  const resolvedTickets = await findTicketsByReference([rawReferenceNumber]);
  if (resolvedTickets.length > 0) {
    await confirmPaymentForTickets(resolvedTickets);
    return res.json({ success: true, message: "Simulation de paiement effectuée." });
  }

  res.status(404).json({ error: "Billet introuvable pour simulation." });
});

export default router;
