import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Emulate __dirname/__filename for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const PAYMENT_PRO_CALLBACK_SECRET = (process.env.PAYMENT_PRO_CALLBACK_SECRET || "").trim();
const PAYMENT_WEBHOOK_SECRET = (process.env.PAYMENT_WEBHOOK_SECRET || "").trim();
const PAYMENT_PRO_CALLBACK_ORIGIN = (process.env.PAYMENT_PRO_CALLBACK_ORIGIN || "https://paiementpro.net").trim();
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const RESEND_FROM_EMAIL = (process.env.RESEND_FROM_EMAIL || "ClicBillet <no-reply@monticket.online>").trim();
const ADMIN_NOTIFICATION_EMAIL = (process.env.ADMIN_NOTIFICATION_EMAIL || "admin@monticket.online").trim();
const SUPABASE_WEBHOOK_SECRET = (process.env.SUPABASE_WEBHOOK_SECRET || "").trim();

// Le serveur n'utilise que la clé service_role : toutes les routes qui touchent à des
// données sensibles sont déjà protégées par requireAuth/requireRole côté Express, donc un
// client "anon" séparé (qui ne ferait que retomber sur service_role en pratique) n'apporte
// rien ici et n'est jamais sollicité par le frontend (qui ne parle jamais à Supabase
// directement).
const useSupabaseAdmin = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabaseAdmin = useSupabaseAdmin ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;
const supabase = supabaseAdmin;
const isSupabaseEnabled = Boolean(supabase);

// supabase-js attache automatiquement le token de la session active aux requêtes de table
// dès qu'on appelle auth.signUp/signInWithPassword sur un client (cf. SupabaseClient._getAccessToken).
// Si on appelait ces méthodes sur `supabaseAdmin`, ce dernier perdrait son accès service_role
// pour toutes les requêtes .from(...) suivantes et se ferait bloquer par RLS. On utilise donc
// un client jetable, sans session persistée, uniquement pour vérifier/créer les identifiants.
function createEphemeralAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

const LOCAL_ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || crypto.randomBytes(12).toString("hex");
const LOCAL_CLIENT_PASSWORD = process.env.LOCAL_CLIENT_PASSWORD || crypto.randomBytes(12).toString("hex");
const LOCAL_ORGANIZER_PASSWORD = process.env.LOCAL_ORGANIZER_PASSWORD || crypto.randomBytes(12).toString("hex");

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
  console.error("[Security] Aucune connexion Supabase valide détectée en production. Le serveur continuera, mais cela est dangereux.");
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HMR_PORT = Number(process.env.HMR_PORT || process.env.WS_PORT) || 24678;

// Basic security headers
// Origines des passerelles de paiement (Paiement Pro et les opérateurs mobile money qu'il
// route en arrière-plan) ainsi que le domaine de production, à autoriser pour les redirections,
// requêtes XHR et formulaires de paiement.
const PAYMENT_GATEWAY_ORIGINS = [
  "https://clicbillet.com",
  "https://www.clicbillet.com",
  "https://*.paiementpro.net",
  "https://paiementpro.net",
  "https://mpayment.orange-money.com",
  "https://multi.app.orange-money.com",
  "https://maxit-link.com",
  "https://pay.wave.com",
  "https://www.wave.com",
  "https://*.confirm.wave.com",
  "https://promo.wave.com",
];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://paiementpro.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'", `ws://127.0.0.1:${HMR_PORT}`, `ws://localhost:${HMR_PORT}`, ...PAYMENT_GATEWAY_ORIGINS],
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

// Path to durable local JSON Database
const DB_FILE = path.join(process.cwd(), "db.json");

// Define basic initial DB structure
const INITIAL_DATABASE = {
  users: [
    {
      id: "usr-admin",
      email: "admin@clicbillet.ci",
      password: bcrypt.hashSync(LOCAL_ADMIN_PASSWORD, 10),
      name: "Administrateur ClicBillet",
      role: "admin"
    },
    {
      id: "usr-client",
      email: "client@clicbillet.ci",
      password: bcrypt.hashSync(LOCAL_CLIENT_PASSWORD, 10),
      name: "Jean-Eudes Koffi",
      role: "client"
    },
    {
      id: "org-1",
      email: "orga@clicbillet.ci",
      password: bcrypt.hashSync(LOCAL_ORGANIZER_PASSWORD, 10),
      name: "Overcom Production",
      role: "organizer"
    }
  ],
  events: [
    {
      id: "evt-1",
      title: "Concert Géant de Didi B (Live à l'Agora d'Abobo)",
      description: "Le Shogun de la musique ivoirienne Didi B vous donne rendez-vous pour un concert d'anthologie à l'Agora d'Abobo. Ambiance 100% Rap Ivoire, effets spéciaux et prestations scéniques exceptionnelles !",
      date: "2026-07-25",
      time: "18:00",
      price: 5000,
      venue: "Agora d'Abobo, Abidjan",
      category: "Concert",
      banner: "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&auto=format&fit=crop&q=60",
      ticketsSold: 345,
      totalTickets: 1500,
      organizerId: "org-1",
      organizerName: "Overcom Production"
    },
    {
      id: "evt-2",
      title: "Festival des Grillades d'Abidjan - 19ème Édition",
      description: "Le plus grand événement gastronomique de Côte d'Ivoire ! Venez savourer les meilleures grillades (poulets braisés, choucouya de mouton, attiéké poisson) rythmées par les prestations d'artistes majeurs de la scène ivoirienne.",
      date: "2026-08-15",
      time: "12:00",
      price: 3000,
      venue: "Palais de la Culture, Treichville, Abidjan",
      category: "Festivals",
      banner: "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=60",
      ticketsSold: 1205,
      totalTickets: 5000,
      organizerId: "org-1",
      organizerName: "Overcom Production"
    },
    {
      id: "evt-3",
      title: "Le Parlement du Rire : Gohou, Boukary & Amis",
      description: "Une thérapie par le rire d'une intensité folle ! Les sommités de l'humour ouest-africain réunies pour un spectacle inoubliable. Préparez-vous à rire aux éclats !",
      date: "2026-06-30",
      time: "20:00",
      price: 10000,
      venue: "Salle Anoumabo, Palais de la Culture",
      category: "Théâtre & Humour",
      banner: "https://images.unsplash.com/photo-1516280440614-37939bbacd6a?w=800&auto=format&fit=crop&q=60",
      ticketsSold: 180,
      totalTickets: 1200,
      organizerId: "org-1",
      organizerName: "Overcom Production"
    },
    {
      id: "evt-4",
      title: "Super Classico Maracana : Abidjan vs Yamoussoukro",
      description: "La grande finale de la ligue nationale de Maracana de Côte d'Ivoire. Venez encourager votre équipe favorite lors de chocs spectaculaires suivis de concerts live originaux localisés d'ambiance facile !",
      date: "2026-07-12",
      time: "15:00",
      price: 2000,
      venue: "Forum de l'Université de Cocody, Abidjan",
      category: "Sport",
      banner: "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60",
      ticketsSold: 67,
      totalTickets: 800,
      organizerId: "org-2",
      organizerName: "Fédération Maracana CI"
    }
  ],
  tickets: [
    {
      id: "tkt-simulated-1",
      eventId: "evt-1",
      eventTitle: "Concert Géant de Didi B (Live à l'Agora d'Abobo)",
      eventDate: "2026-07-25",
      eventTime: "18:00",
      eventVenue: "Agora d'Abobo, Abidjan",
      buyerId: "usr-client",
      buyerName: "Jean-Eudes Koffi",
      buyerEmail: "client@clicbillet.ci",
      tier: "vip",
      pricePaid: 15000,
      qrCodeData: "clicbillet-verify:tkt-simulated-1",
      scanned: false,
      scannedAt: null,
      transactionRef: "TX-OM-5493010",
      purchaseDate: "2026-06-08T14:30:00Z",
      quantity: 1
    }
  ],
  payouts: [],
  transactions: []
};

// Initialize DB file helper
function getDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(INITIAL_DATABASE, null, 2), "utf8");
      return INITIAL_DATABASE;
    }
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const db = JSON.parse(raw);
    
    // Ensure the main admin account is present
    if (!db.users.some((u: any) => u.email.toLowerCase() === "admin@clicbillet.ci")) {
      db.users.unshift({
        id: "usr-admin",
        email: "admin@clicbillet.ci",
        password: bcrypt.hashSync(LOCAL_ADMIN_PASSWORD, 10),
        name: "Administrateur ClicBillet",
        role: "admin"
      });
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
    }

    // Migrate any plaintext passwords to bcrypt-hashed values
    let migrated = false;
    for (const u of db.users) {
      if (u.password && typeof u.password === "string" && !/^\$2[aby]\$/.test(u.password)) {
        u.password = bcrypt.hashSync(String(u.password), 10);
        migrated = true;
      }
    }
    if (migrated) {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
      } catch (e) {
        console.warn("Failed to persist migrated hashed passwords:", e);
      }
    }
    return db;
  } catch (error) {
    console.error("Error reading db.json, returning initial value", error);
    return INITIAL_DATABASE;
  }
}

function saveDB(data: typeof INITIAL_DATABASE) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Error saving to db.json", err);
  }
}

// ==========================================
// SERVICE D'ENVOI D'EMAILS (Resend)
// ==========================================
// Best-effort partout : un échec d'envoi d'email ne doit jamais faire échouer
// la route métier qui l'a déclenché (achat de billet, inscription, etc.).
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> {
  if (!to) return false;

  if (!RESEND_API_KEY) {
    console.log(`[Email Mock Service] ✉️ (Resend non configuré) Sujet="${subject}" -> ${to}`);
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to,
        subject,
        html
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[Email Service] Échec d'envoi Resend (${response.status}) à ${to} :`, errorBody);
      return false;
    }

    console.log(`[Email Service] ✉️ Email envoyé via Resend à ${to} ("${subject}")`);
    return true;
  } catch (err: any) {
    console.error(`[Email Service] Erreur réseau lors de l'envoi à ${to} :`, err.message || err);
    return false;
  }
}

function emailLayout(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <h1 style="color: #ea580c;">ClicBillet</h1>
      <h2 style="font-size: 18px;">${title}</h2>
      ${bodyHtml}
      <p style="margin-top: 32px; font-size: 12px; color: #6b7280;">
        Cet email a été envoyé automatiquement par ClicBillet, ne pas répondre directement.
      </p>
    </div>
  `;
}

const ROLE_LABELS: Record<string, string> = {
  client: "Acheteur",
  organizer: "Organisateur",
  admin: "Administrateur"
};

// --- Bienvenue (inscription) ---
function buildWelcomeEmailHtml(name: string, role: string): string {
  const roleLabel = ROLE_LABELS[role] || "Membre";
  return emailLayout("Bienvenue sur ClicBillet !", `
    <p>Bonjour ${name},</p>
    <p>Votre compte <strong>${roleLabel}</strong> a bien été créé sur ClicBillet, la plateforme de billetterie événementielle en Côte d'Ivoire.</p>
    <p>Vous pouvez dès à présent vous connecter et profiter de la plateforme.</p>
  `);
}

async function sendWelcomeEmail(user: { email: string; name: string; role: string }): Promise<void> {
  await sendEmail({
    to: user.email,
    subject: "Bienvenue sur ClicBillet !",
    html: buildWelcomeEmailHtml(user.name, user.role)
  });
}

// --- Acheteur : confirmation de billet ---
function buildTicketConfirmationHtml(ticket: any): string {
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(ticket.qrCodeData)}`;
  return emailLayout("Votre billet est confirmé !", `
    <p>Bonjour ${ticket.buyerName},</p>
    <p>Merci pour votre achat. Voici les détails de votre commande :</p>
    <ul>
      <li><strong>Événement :</strong> ${ticket.eventTitle}</li>
      <li><strong>Date :</strong> ${ticket.eventDate} à ${ticket.eventTime}</li>
      <li><strong>Lieu :</strong> ${ticket.eventVenue}</li>
      <li><strong>Quantité :</strong> ${ticket.quantity}</li>
      <li><strong>Catégorie :</strong> ${ticket.tier}</li>
    </ul>
    <p>Présentez ce QR code à l'entrée :</p>
    <img src="${qrImageUrl}" alt="QR Code billet" width="220" height="220" />
  `);
}

async function sendTicketEmail(ticket: any): Promise<void> {
  await sendEmail({
    to: ticket.buyerEmail,
    subject: `Vos billets pour ${ticket.eventTitle}`,
    html: buildTicketConfirmationHtml(ticket)
  });
}

// --- Acheteur : échec de paiement ---
function buildPaymentFailedHtml(ticket: any): string {
  return emailLayout("Échec de votre paiement", `
    <p>Bonjour ${ticket.buyerName || ticket.buyer_name},</p>
    <p>Le paiement de votre commande pour l'événement <strong>${ticket.eventTitle || ticket.event_title}</strong> n'a pas pu être validé.</p>
    <p>Aucun montant n'a été débité de façon définitive. Vous pouvez retenter votre achat depuis la plateforme.</p>
  `);
}

async function sendPaymentFailedEmail(ticket: any): Promise<void> {
  const to = ticket.buyerEmail || ticket.buyer_email;
  await sendEmail({
    to,
    subject: `Échec du paiement pour ${ticket.eventTitle || ticket.event_title}`,
    html: buildPaymentFailedHtml(ticket)
  });
}

// --- Organisateur : nouvelle vente ---
function buildOrganizerSaleHtml(eventTitle: string, organizerName: string, ticket: any): string {
  return emailLayout("Nouvelle vente de billet !", `
    <p>Bonjour ${organizerName},</p>
    <p>Une nouvelle vente vient d'avoir lieu sur votre événement <strong>${eventTitle}</strong> :</p>
    <ul>
      <li><strong>Acheteur :</strong> ${ticket.buyerName || ticket.buyer_name}</li>
      <li><strong>Quantité :</strong> ${ticket.quantity}</li>
      <li><strong>Montant :</strong> ${ticket.pricePaid || ticket.price_paid} FCFA</li>
    </ul>
  `);
}

async function sendOrganizerSaleEmail(organizerEmail: string, organizerName: string, eventTitle: string, ticket: any): Promise<void> {
  if (!organizerEmail) return;
  await sendEmail({
    to: organizerEmail,
    subject: `Nouvelle vente pour ${eventTitle}`,
    html: buildOrganizerSaleHtml(eventTitle, organizerName, ticket)
  });
}

// --- Organisateur : statut de l'événement ---
function buildOrganizerEventStatusHtml(eventTitle: string, organizerName: string, status: string): string {
  const statusLabel = status === "approved" ? "approuvé" : "rejeté";
  return emailLayout(`Votre événement a été ${statusLabel}`, `
    <p>Bonjour ${organizerName},</p>
    <p>Votre événement <strong>${eventTitle}</strong> a été <strong>${statusLabel}</strong> par l'équipe de modération ClicBillet.</p>
  `);
}

async function sendOrganizerEventStatusEmail(organizerEmail: string, organizerName: string, eventTitle: string, status: string): Promise<void> {
  if (!organizerEmail) return;
  const statusLabel = status === "approved" ? "approuvé" : "rejeté";
  await sendEmail({
    to: organizerEmail,
    subject: `Votre événement "${eventTitle}" a été ${statusLabel}`,
    html: buildOrganizerEventStatusHtml(eventTitle, organizerName, status)
  });
}

// --- Organisateur : statut de retrait (payout) ---
function buildOrganizerPayoutStatusHtml(organizerName: string, payout: any): string {
  const statusLabels: Record<string, string> = { completed: "complété", rejected: "rejeté", pending: "en attente" };
  const statusLabel = statusLabels[payout.status] || payout.status;
  return emailLayout(`Votre demande de retrait est ${statusLabel}`, `
    <p>Bonjour ${organizerName},</p>
    <p>Votre demande de retrait de <strong>${payout.amount} FCFA</strong> (méthode : ${payout.method}) est désormais <strong>${statusLabel}</strong>.</p>
  `);
}

async function sendOrganizerPayoutStatusEmail(organizerEmail: string, organizerName: string, payout: any): Promise<void> {
  if (!organizerEmail) return;
  await sendEmail({
    to: organizerEmail,
    subject: `Statut de votre demande de retrait : ${payout.status}`,
    html: buildOrganizerPayoutStatusHtml(organizerName, payout)
  });
}

// --- Admin : nouvelle inscription organisateur ---
function buildAdminNewOrganizerHtml(user: { name: string; email: string }): string {
  return emailLayout("Nouvel organisateur inscrit", `
    <p>Un nouvel organisateur vient de s'inscrire sur ClicBillet :</p>
    <ul>
      <li><strong>Nom :</strong> ${user.name}</li>
      <li><strong>Email :</strong> ${user.email}</li>
    </ul>
  `);
}

async function sendAdminNewOrganizerEmail(user: { name: string; email: string }): Promise<void> {
  await sendEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: "Nouvel organisateur inscrit sur ClicBillet",
    html: buildAdminNewOrganizerHtml(user)
  });
}

// --- Admin : nouvelle demande de retrait ---
function buildAdminPayoutRequestHtml(organizerName: string, payout: any): string {
  return emailLayout("Nouvelle demande de retrait", `
    <p>L'organisateur <strong>${organizerName}</strong> a soumis une nouvelle demande de retrait :</p>
    <ul>
      <li><strong>Montant :</strong> ${payout.amount} FCFA</li>
      <li><strong>Méthode :</strong> ${payout.method}</li>
    </ul>
    <p>Rendez-vous sur le tableau de bord admin pour la traiter.</p>
  `);
}

async function sendAdminPayoutRequestEmail(organizerName: string, payout: any): Promise<void> {
  await sendEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: `Nouvelle demande de retrait de ${organizerName}`,
    html: buildAdminPayoutRequestHtml(organizerName, payout)
  });
}

// Enable parsing middlewares for Webhooks and APIs
app.use(express.json({
  verify(req, res, buf) {
    (req as any).rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

function extractBearerToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

async function getAuthenticatedUser(req: express.Request): Promise<any | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  // Les tokens "local-<id>" sont émis par le repli db.json (signup/login), qui peut être
  // utilisé même quand Supabase est configuré (si l'appel Supabase échoue ponctuellement).
  // Ils ne sont jamais des JWT Supabase valides, donc on les distingue en premier plutôt
  // que de laisser la branche Supabase ci-dessous les rejeter systématiquement.
  const localPrefix = "local-";
  if (token.startsWith(localPrefix)) {
    const localUserId = token.substring(localPrefix.length);
    if (!localUserId) return null;
    const db = getDB();
    const localUser = db.users.find((u: any) => u.id === localUserId);
    if (!localUser) return null;
    return {
      id: localUser.id,
      email: localUser.email,
      role: localUser.role
    };
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const authClient = supabase;
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) {
        return null;
      }
      const userId = data.user.id;
      const { data: profile, error: profileError } = await authClient
        .from("users")
        .select("id,email,role")
        .eq("id", userId)
        .maybeSingle();

      if (profileError || !profile) {
        return null;
      }

      return {
        id: profile.id,
        email: profile.email,
        role: profile.role
      };
    } catch (err) {
      return null;
    }
  }

  return null;
}

async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: "Token d'authentification manquant ou invalide." });
  }
  (req as any).user = user;
  next();
}

function requireRole(...allowedRoles: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: "Accès refusé : rôle insuffisant." });
    }
    next();
  };
}

function getPaymentSignature(req: express.Request): string | null {
  const headerValue = req.headers["x-paiementpro-signature"] || req.headers["x-signature"] || req.headers["x-webhook-signature"];
  if (!headerValue) return null;
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }
  return headerValue;
}

function verifyPaymentSignature(req: express.Request): boolean {
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

function corsAllowedOrigin(req: express.Request): string | undefined {
  const origin = (req.headers.origin || "").toString();
  if (!origin) return undefined;
  if (origin === PAYMENT_PRO_CALLBACK_ORIGIN) return origin;
  return undefined;
}

function getWebhookSecretFromRequest(req: express.Request): string | null {
  const querySecret = req.query.wh;
  if (typeof querySecret === "string") return querySecret;
  if (Array.isArray(querySecret)) return querySecret[0];
  const bodySecret = req.body?.wh;
  if (typeof bodySecret === "string") return bodySecret;
  if (typeof bodySecret === "number") return String(bodySecret);
  return null;
}

function buildWebhookNotificationUrl(req: express.Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const scheme = typeof forwardedProto === "string" ? forwardedProto : req.protocol;
  const host = req.get("host") || "localhost:3000";
  const origin = req.get("origin") || `${scheme}://${host}`;
  const baseUrl = `${origin.replace(/\/$/, "")}/api/payment/callback`;
  if (PAYMENT_WEBHOOK_SECRET) {
    return `${baseUrl}?wh=${encodeURIComponent(PAYMENT_WEBHOOK_SECRET)}`;
  }
  return baseUrl;
}

/**
 * UTILS DE SÉCURITÉ ET D'ASSAINISSEMENT DES ENTRÉES
 * Protège les points de terminaison de l'API contre les failles d'injection (SQL, XSS, etc.)
 */

function sanitizeString(val: string): string {
  if (!val) return "";
  let s = val.trim();
  // Neutralise les balises HTML ou scripts pour éviter l'exécution XSS
  s = s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Bloque les gestionnaires d'événements JavaScript actifs suspects
  s = s.replace(/(javascript:|onload|onerror|onclick|onmouseover|onfocus|onkeydown|script)/gi, "[REDACTED_EVENT_HANDLER]");
  return s;
}

function sanitizeObject(obj: any): any {
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

// Middleware de validation de structure pour l'inscription d'utilisateurs
const validateRegister = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { email, password, name, role } = req.body;

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: "Tous les champs d'inscription sont obligatoires (email, password, name, role)." });
  }

  // Vérification rigoureuse du format e-mail
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Le format de l'e-mail est invalide." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères pour des raisons de sécurité." });
  }

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: "Le nom doit comporter entre 2 et 100 caractères." });
  }

  if (role !== "client" && role !== "organizer") {
    return res.status(400).json({ error: "Rôle utilisateur invalide spécifié." });
  }

  next();
};

// Middleware de validation de structure pour la connexion d'utilisateurs
const validateLogin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Veuillez saisir votre e-mail et votre mot de passe." });
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Le format de l'e-mail est invalide." });
  }

  next();
};

// Middleware de validation pour la création / modification d'événements
const validateEvent = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { title, date, time, price, venue, category, banner, totalTickets, organizerId } = req.body;

  if (!title || !date || !time || !venue || !category || !organizerId) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires correctement." });
  }

  if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ error: "Le tarif doit être un nombre positif ou nul." });
  }

  if (totalTickets === undefined || isNaN(Number(totalTickets)) || Number(totalTickets) <= 0) {
    return res.status(400).json({ error: "Le nombre total de billets doit être un nombre positif supérieur à zéro." });
  }

  // Contraintes de limites de sécurité pour éviter le spam, les overflows de mémoire ou l'épuisement de ressources
  if (Number(price) > 50000000) {
    return res.status(400).json({ error: "Le prix de l'événement dépasse la limite autorisée." });
  }

  if (Number(totalTickets) > 1000000) {
    return res.status(400).json({ error: "La quantité totale de billets est trop élevée." });
  }

  // Validation du format de la date YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: "Le format de la date doit être YYYY-MM-DD." });
  }

  // Validation du format de l'heure HH:MM
  const timeRegex = /^\d{2}:\d{2}$/;
  if (!timeRegex.test(time)) {
    return res.status(400).json({ error: "Le format de l'heure doit être HH:MM." });
  }

  if (banner && !banner.startsWith("http://") && !banner.startsWith("https://")) {
    return res.status(400).json({ error: "L'URL de l'image de couverture est invalide (doit commencer par http:// ou https://)." });
  }

  next();
};

// Middleware de validation de commande de billet (Checkout)
const validateCheckout = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  let { eventId, buyerId, buyerName, buyerEmail, tier, quantity, paymentDetails } = req.body;
  const normalizedTier = typeof tier === "string" ? tier.toLowerCase() : tier;
  req.body.tier = normalizedTier;
  tier = normalizedTier;

  if (!eventId || !buyerId || !buyerName || !buyerEmail || !tier || !quantity || !paymentDetails) {
    return res.status(400).json({ error: "Champs d'achat de billets incomplets." });
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(buyerEmail)) {
    return res.status(400).json({ error: "L'adresse e-mail de l'acheteur est invalide." });
  }

  if (tier !== "standard" && tier !== "vip") {
    return res.status(400).json({ error: "Le ticket doit être de type 'standard' ou 'vip'." });
  }

  const qtyVal = Number(quantity);
  if (isNaN(qtyVal) || qtyVal < 1 || qtyVal > 20) {
    return res.status(400).json({ error: "La quantité achetée doit être comprise d'une valeur de 1 à 20 billets par commande." });
  }

  if (!paymentDetails.method) {
    return res.status(400).json({ error: "Moyen de facturation requis." });
  }

  const allowedMethods = ["orange_money", "mtn_momo", "moov_money", "wave", "card"];
  if (!allowedMethods.includes(paymentDetails.method)) {
    return res.status(400).json({ error: "Passerelle de transaction invalide." });
  }

  next();
};

// Middleware de validation de scan d'accès ticket
const validateVerifyTicket = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { qrCodeData } = req.body;

  if (!qrCodeData) {
    return res.status(400).json({ error: "Code QR d'accès requis." });
  }

  if (!qrCodeData.startsWith("clicbillet-verify:")) {
    return res.status(400).json({ error: "Format de code d'accès ou signature invalide." });
  }

  next();
};

// API Endpoints: Event Fetching
app.get("/api/events", async (req: express.Request, res: express.Response) => {
  const { includePending } = req.query;

  if (isSupabaseEnabled && supabase) {
    try {
      let query = supabase.from("events").select("*").order("created_at", { ascending: false });
      if (!includePending) {
        query = query.eq("status", "approved");
      }
      let { data, error } = await query;

      // Handle missing 'status' column in legacy Supabase schemas gracefully
      if (error && error.message.includes('status')) {
        const fallbackQuery = await supabase.from("events").select("*").order("created_at", { ascending: false });
        if (!fallbackQuery.error) {
           data = fallbackQuery.data;
           error = null;
        } else {
           throw fallbackQuery.error;
        }
      }

      if (error) throw error;

      // Map snake_case columns back to camelCase frontend expectations
      const mappedEvents = (data || []).map((e: any) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        date: e.date,
        time: e.time,
        price: Number(e.price),
        ticketTypes: e.ticket_types,
        venue: e.venue,
        category: e.category,
        banner: e.banner,
        ticketsSold: e.tickets_sold ?? 0,
        totalTickets: e.total_tickets,
        organizerId: e.organizer_id,
        organizerName: e.organizer_name,
        status: e.status || "approved"
      }));
      return res.json(mappedEvents);
    } catch (err: any) {
      console.error("[Supabase Error] Fetching events, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  let events = db.events || [];
  if (!includePending) {
    events = events.filter((e: any) => e.status === "approved" || !e.status);
  }
  res.json(events);
});

// Create Event Endpoint for Organizers
app.post("/api/events", validateEvent, async (req: express.Request, res: express.Response) => {
  const { title, description, date, time, price, ticketTypes, venue, category, banner, totalTickets, organizerId, organizerName } = req.body;

  if (!title || !date || !time || isNaN(price) || !venue || !category || !totalTickets || !organizerId) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires correctement." });
  }

  const newEventId = `evt-${Date.now()}`;
  const bannerUrl = banner || "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&auto=format&fit=crop&q=60";

  if (isSupabaseEnabled && supabase) {
    try {
      let insertedData;
      let { data, error } = await supabase
        .from("events")
        .insert({
          id: newEventId,
          title,
          description: description || "Aucune description fournie.",
          date,
          time,
          price: Number(price),
          ticket_types: ticketTypes,
          venue,
          category,
          banner: bannerUrl,
          tickets_sold: 0,
          total_tickets: Number(totalTickets),
          organizer_id: organizerId,
          organizer_name: organizerName || "Organisateur ClicBillet",
          status: 'pending'
        })
        .select()
        .single();
        
      if (error && error.message.includes('status')) {
        // Fallback for legacy DB missing 'status'
        const fallback = await supabase
          .from("events")
          .insert({
            id: newEventId,
            title,
            description: description || "Aucune description fournie.",
            date,
            time,
            price: Number(price),
            ticket_types: ticketTypes,
            venue,
            category,
            banner: bannerUrl,
            tickets_sold: 0,
            total_tickets: Number(totalTickets),
            organizer_id: organizerId,
            organizer_name: organizerName || "Organisateur ClicBillet"
          })
          .select()
          .single();
          
          if (fallback.error) throw fallback.error;
          data = fallback.data;
          error = null;
      }

      if (error) throw error;

      const mappedEvent = {
        id: data.id,
        title: data.title,
        description: data.description,
        date: data.date,
        time: data.time,
        price: Number(data.price),
        ticketTypes: data.ticket_types,
        venue: data.venue,
        category: data.category,
        banner: data.banner,
        ticketsSold: data.tickets_sold,
        totalTickets: data.total_tickets,
        organizerId: data.organizer_id,
        organizerName: data.organizer_name
      };

      return res.status(201).json(mappedEvent);
    } catch (err: any) {
      console.error("[Supabase Error] Creating event, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const newEvent = {
    id: newEventId,
    title,
    description: description || "Aucune description fournie.",
    date,
    time,
    price: Number(price),
    ticketTypes,
    venue,
    category,
    banner: bannerUrl,
    ticketsSold: 0,
    totalTickets: Number(totalTickets),
    organizerId,
    organizerName: organizerName || "Organisateur ClicBillet"
  };

  db.events.unshift(newEvent); // put on top
  saveDB(db);

  res.status(201).json(newEvent);
});

// Authentication Endpoints
app.post("/api/auth/register", validateRegister, async (req: express.Request, res: express.Response) => {
  const { email, password, name, role } = req.body;

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: "Informations d'inscription incomplètes." });
  }

  const normalizedEmail = email.toLowerCase();

  if (isSupabaseEnabled && supabase) {
    try {
      // 1. Check if user already exists in public table (just to avoid auth spam)
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (existingUser) {
        return res.status(400).json({ error: "Un utilisateur avec cet e-mail existe déjà." });
      }

      // 2. Register inside Supabase Auth.
      // We first try using the Admin Auth API (available if service_role key is used)
      // to create an auto-confirmed account and avoid email verification in rapid prototypes.
      let authUser: any = null;
      let isSignUpFallbackNeeded = false;

      try {
        const adminAuthClient = supabaseAdmin;
        if (!adminAuthClient) {
          isSignUpFallbackNeeded = true;
        } else {
          const { data: adminData, error: adminError } = await adminAuthClient.auth.admin.createUser({
            email: normalizedEmail,
            password: password,
            email_confirm: true,
            user_metadata: { name, role }
          });

          if (adminError) {
            // If the error says it's not authorized, this means we only have the anon API key, not service_role.
            // In that case we will fallback to the normal signUp.
            if (adminError.status === 401 || adminError.status === 403 || adminError.message.includes("authorized")) {
              isSignUpFallbackNeeded = true;
            } else {
              throw adminError;
            }
          } else {
            authUser = adminData?.user;
          }
        }
      } catch (adminException) {
        isSignUpFallbackNeeded = true;
      }

      if (isSignUpFallbackNeeded) {
        // Fallback to client-side signUp if the service role key is not active on this environment.
        // Utilise un client jetable pour ne pas faire perdre à `supabase`/`supabaseAdmin` son
        // accès service_role sur les requêtes de table suivantes (cf. createEphemeralAuthClient).
        const { data: clientData, error: clientError } = await createEphemeralAuthClient().auth.signUp({
          email: normalizedEmail,
          password: password,
          options: {
            data: { name, role }
          }
        });

        if (clientError) {
          return res.status(400).json({ error: clientError.message });
        }
        authUser = clientData?.user;
      }

      if (!authUser) {
        return res.status(500).json({ error: "Échec de l'enregistrement de l'utilisateur sur l'authentification Supabase." });
      }

      // 3. Create public profile row linking to the native Supabase auth user.id
      const { data, error: profileError } = await supabase
        .from("users")
        .insert({
          id: authUser.id,
          email: normalizedEmail,
          password: "[SECURE_SUPABASE_AUTH]", // Mots de passe gérés en toute sécurité par Supabase Auth
          name,
          role: role === "organizer" ? "organizer" : "client"
        })
        .select()
        .single();

      if (profileError) {
        throw profileError;
      }

      // L'admin.createUser ci-dessus ne crée pas de session : on en ouvre une explicitement
      // pour que le frontend reparte immédiatement avec un token valide (sinon tout appel
      // requireAuth échoue en 401 jusqu'à ce que l'utilisateur se reconnecte manuellement).
      let sessionToken: string | undefined;
      let sessionRefreshToken: string | undefined;
      try {
        const { data: signInData } = await createEphemeralAuthClient().auth.signInWithPassword({
          email: normalizedEmail,
          password
        });
        sessionToken = signInData?.session?.access_token;
        sessionRefreshToken = signInData?.session?.refresh_token;
      } catch (signInErr: any) {
        console.warn("[Supabase Warning] Impossible d'ouvrir une session juste après l'inscription :", signInErr.message);
      }

      return res.status(201).json({
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        token: sessionToken,
        refreshToken: sessionRefreshToken
      });
    } catch (err: any) {
      console.error("[Supabase Error] User registration, falling back to local file DB:", err.message);
    }
  }

  // Fallback Database
  const db = getDB();
  const exists = db.users.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: "Un utilisateur avec cet e-mail existe déjà." });
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    email: email.toLowerCase(),
    password: bcrypt.hashSync(password, 10),
    name,
    role: role === "organizer" ? ("organizer" as const) : ("client" as const)
  };

  db.users.push(newUser);
  saveDB(db);

  // Webhook DB Supabase indisponible sur ce repli local : on envoie directement
  // l'email de bienvenue (+ notification admin si organisateur) en filet de sécurité.
  sendWelcomeEmail({ email: newUser.email, name: newUser.name, role: newUser.role }).catch(() => {});
  if (newUser.role === "organizer") {
    sendAdminNewOrganizerEmail({ name: newUser.name, email: newUser.email }).catch(() => {});
  }

  // Return user without password and include a local development token.
  const { password: _, ...userWithoutPassword } = newUser;
  res.status(201).json({
    ...userWithoutPassword,
    token: `local-${newUser.id}`
  });
});

app.post("/api/auth/login", validateLogin, async (req: express.Request, res: express.Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Veuillez saisir votre email et mot de passe." });
  }

  const normalizedEmail = email.toLowerCase();

  if (isSupabaseEnabled && supabase) {
    try {
      // 1. Authenticate using Supabase Auth (Native cryptographic match).
      // Utilise un client jetable pour ne pas faire perdre à `supabase`/`supabaseAdmin` son
      // accès service_role sur les requêtes de table suivantes (cf. createEphemeralAuthClient).
      const { data: authData, error: authError } = await createEphemeralAuthClient().auth.signInWithPassword({
        email: normalizedEmail,
        password: password,
      });

      if (authError) {
        return res.status(401).json({ error: "Identifiant ou mot de passe incorrect. " + authError.message });
      }

      const authUser = authData?.user;
      if (!authUser) {
        return res.status(401).json({ error: "Identifiants de connexion invalides." });
      }

      // 2. Fetch profile from our public user table matching the authenticating user UUID
      let { data: profile, error: profileError } = await supabase
        .from("users")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      // Auto-healing: If user exists in Auth but not in public table, let's create it on-the-fly
      if (!profile) {
        const userMetaName = authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Abonné ClicBillet";
        const userMetaRole = authUser.user_metadata?.role || "client";

        const { data: newProfile, error: createProfileError } = await supabase
          .from("users")
          .insert({
            id: authUser.id,
            email: normalizedEmail,
            password: "[SECURE_SUPABASE_AUTH]",
            name: userMetaName,
            role: userMetaRole
          })
          .select()
          .single();

        if (createProfileError) {
          console.error("[Supabase Error] Impossibilité de créer le profil manquant :", createProfileError.message);
        } else {
          profile = newProfile;
        }
      }

      if (profile) {
        return res.json({
          id: profile.id,
          email: profile.email,
          name: profile.name,
          role: profile.role,
          token: authData?.session?.access_token,
          refreshToken: authData?.session?.refresh_token
        });
      }

      // Safe placeholder if table entry failed completely
      return res.json({
        id: authUser.id,
        email: authUser.email,
        name: authUser.email?.split("@")[0] || "Abonné ClicBillet",
        role: "client"
      });
    } catch (err: any) {
      console.error("[Supabase Error] User login, falling back to local file DB:", err.message);
    }
  }

  // Fallback database lookup
  const db = getDB();
  const user = db.users.find((u: any) => u.email.toLowerCase() === email.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Identifiants de connexion invalides." });
  }

  const { password: _, ...userWithoutPassword } = user;
  res.json({
    ...userWithoutPassword,
    token: `local-${user.id}`
  });
});

// Rafraîchissement de session : les access_token Supabase expirent (par défaut au bout
// d'1h). Le frontend appelle cette route avec le refresh_token stocké pour obtenir un
// nouveau access_token sans forcer l'utilisateur à se reconnecter manuellement.
app.post("/api/auth/refresh", async (req: express.Request, res: express.Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken manquant." });
  }

  if (!isSupabaseEnabled) {
    return res.status(400).json({ error: "Rafraîchissement de session non disponible." });
  }

  try {
    const { data, error } = await createEphemeralAuthClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      return res.status(401).json({ error: "Session expirée, veuillez vous reconnecter." });
    }
    return res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token
    });
  } catch (err: any) {
    console.error("[Supabase Error] Refresh session:", err.message);
    return res.status(401).json({ error: "Session expirée, veuillez vous reconnecter." });
  }
});

// Fetch User Purchased Tickets Endpoint
app.get("/api/my-tickets", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const buyerId = authUser?.id;

  if (!buyerId) {
    return res.status(500).json({ error: "Impossible de récupérer l'identité de l'utilisateur." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("buyer_id", buyerId)
        .order("purchase_date", { ascending: false });

      if (error) throw error;

      const mappedTickets = (data || []).map((t: any) => ({
        id: t.id,
        eventId: t.event_id,
        eventTitle: t.event_title,
        eventDate: t.event_date,
        eventTime: t.event_time,
        eventVenue: t.event_venue,
        buyerId: t.buyer_id,
        buyerName: t.buyer_name,
        buyerEmail: t.buyer_email,
        tier: t.tier,
        pricePaid: Number(t.price_paid),
        qrCodeData: t.qr_code_data,
        scanned: t.scanned,
        scannedAt: t.scanned_at,
        transactionRef: t.transaction_ref,
        purchaseDate: t.purchase_date,
        quantity: t.quantity,
        paymentStatus: t.transaction_ref?.startsWith("PENDING-") ? "pending" : "paid"
      }));
      return res.json(mappedTickets);
    } catch (err: any) {
      console.error("[Supabase Error] Fetching my tickets, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const filtered = db.tickets.filter((t: any) => t.buyerId === buyerId).map((t: any) => ({
    ...t,
    paymentStatus: t.transactionRef?.startsWith("PENDING-") ? "pending" : "paid"
  }));
  res.json(filtered);
});

// Checkout Purchase Ticket Endpoint
app.post("/api/checkout", validateCheckout, async (req: express.Request, res: express.Response) => {
  const { eventId, buyerId, buyerName, buyerEmail, tier, quantity, paymentDetails } = req.body;

  if (!eventId || !buyerId || !buyerName || !buyerEmail || !tier || !quantity || !paymentDetails) {
    return res.status(400).json({ error: "Informations de commande incomplètes." });
  }

  const qty = Number(quantity);

  if (isSupabaseEnabled && supabase) {
    try {
      // 1. Fetch Event first to check tickets_sold and total_tickets
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

      if (eventError || !event) {
        return res.status(404).json({ error: "Événement introuvable." });
      }

      const ticketsSold = Number(event.tickets_sold || 0);
      const totalTickets = Number(event.total_tickets || 0);

      if (ticketsSold + qty > totalTickets) {
        return res.status(400).json({ error: "Désolé, il n'y a plus assez de places disponibles." });
      }

      const ticketTypes = event.ticket_types || [];
      const selectedTier = ticketTypes.find((t: any) => typeof t.name === "string" && t.name.toLowerCase() === tier);
      const unitPrice = selectedTier ? Number(selectedTier.price) : Number(event.price);
      const totalPrice = unitPrice * qty;

      const gatewayShortNames: Record<string, string> = {
        orange_money: "OM",
        mtn_momo: "MTN",
        moov_money: "MOOV",
        wave: "WAVE",
        card: "CARD"
      };

      const code = gatewayShortNames[paymentDetails.method] || "PAY";
      const mockTransactionRef = `PENDING-TX-${code}-${Math.floor(1000000 + Math.random() * 9000000)}`;

      // Log transaction attempt
      try {
        await supabase.from("transactions").insert({
          id: mockTransactionRef,
          event_id: eventId,
          buyer_email: buyerEmail,
          amount: totalPrice,
          status: "pending",
          date: new Date().toISOString(),
          method: paymentDetails.method
        });
      } catch (e: any) { console.warn("Supabase tx log error:", e.message); }

      const ticketId = `tkt-${Date.now()}`;

      // 2. Insert Ticket
      const { data: newTkt, error: tktError } = await supabase
        .from("tickets")
        .insert({
          id: ticketId,
          event_id: eventId,
          event_title: event.title,
          event_date: event.date,
          event_time: event.time,
          event_venue: event.venue,
          buyer_id: buyerId,
          buyer_name: buyerName,
          buyer_email: buyerEmail,
          tier: tier as 'standard' | 'vip',
          price_paid: totalPrice,
          qr_code_data: `clicbillet-verify:${ticketId}`,
          scanned: false,
          scanned_at: null,
          transaction_ref: mockTransactionRef,
          quantity: qty
        })
        .select()
        .single();

      if (tktError) throw tktError;

      // 3. Update inventory
      const { error: updateError } = await supabase
        .from("events")
        .update({ tickets_sold: ticketsSold + qty })
        .eq("id", eventId);

      if (updateError) {
        console.error("Failed to update tickets_sold inventory, continuing...", updateError);
      }

      const mappedTicket = {
        id: newTkt.id,
        eventId: newTkt.event_id,
        eventTitle: newTkt.event_title,
        eventDate: newTkt.event_date,
        eventTime: newTkt.event_time,
        eventVenue: newTkt.event_venue,
        buyerId: newTkt.buyer_id,
        buyerName: newTkt.buyer_name,
        buyerEmail: newTkt.buyer_email,
        tier: newTkt.tier,
        pricePaid: Number(newTkt.price_paid),
        qrCodeData: newTkt.qr_code_data,
        scanned: newTkt.scanned,
        scannedAt: newTkt.scanned_at,
        transactionRef: newTkt.transaction_ref,
        purchaseDate: newTkt.purchase_date,
        quantity: newTkt.quantity
      };
      
      // Envoi de l'email
      await sendTicketEmail(mappedTicket);

      // Notification organisateur (best-effort, ne doit jamais bloquer la réponse)
      try {
        const { data: organizerUser } = await supabase
          .from("users")
          .select("email")
          .eq("id", event.organizer_id)
          .maybeSingle();
        await sendOrganizerSaleEmail(organizerUser?.email, event.organizer_name, event.title, mappedTicket);
      } catch (e: any) {
        console.warn("[Email] Notification organisateur (vente) échouée :", e.message);
      }

      return res.status(201).json({
        success: true,
        message: "Achat de billet effectué avec succès !",
        ticket: mappedTicket,
        notificationUrl: buildWebhookNotificationUrl(req)
      });
    } catch (err: any) {
      console.error("[Supabase Error] Checkout, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const event = db.events.find((e: any) => e.id === eventId);

  if (!event) {
    return res.status(404).json({ error: "Événement introuvable." });
  }

  if (event.ticketsSold + qty > event.totalTickets) {
    return res.status(400).json({ error: "Désolé, il n'y a plus assez de places disponibles." });
  }

  const ticketTypes = event.ticketTypes || [];
  const selectedTier = ticketTypes.find((t: any) => typeof t.name === "string" && t.name.toLowerCase() === tier);
  const unitPrice = selectedTier ? Number(selectedTier.price) : Number(event.price);
  const totalPrice = unitPrice * qty;

  // Simulate payment processing based on provider
  const gatewayShortNames: Record<string, string> = {
    orange_money: "OM",
    mtn_momo: "MTN",
    moov_money: "MOOV",
    wave: "WAVE",
    card: "CARD"
  };

  const code = gatewayShortNames[paymentDetails.method] || "PAY";
  const mockTransactionRef = `PENDING-TX-${code}-${Math.floor(1000000 + Math.random() * 9000000)}`;

  db.transactions = db.transactions || [];
  db.transactions.unshift({
    id: mockTransactionRef,
    eventId: eventId,
    buyerEmail: buyerEmail,
    amount: totalPrice,
    status: "pending",
    date: new Date().toISOString(),
    method: paymentDetails.method
  } as any);

  // Generate single grouped ticket, or multiple tickets? Let's generate one ticket indicating quantum
  const ticketId = `tkt-${Date.now()}`;
  const newTicket = {
    id: ticketId,
    eventId: event.id,
    eventTitle: event.title,
    eventDate: event.date,
    eventTime: event.time,
    eventVenue: event.venue,
    buyerId,
    buyerName,
    buyerEmail,
    tier: tier as 'standard' | 'vip',
    pricePaid: totalPrice,
    qrCodeData: `clicbillet-verify:${ticketId}`,
    scanned: false,
    scannedAt: null,
    transactionRef: mockTransactionRef,
    purchaseDate: new Date().toISOString(),
    quantity: qty
  };

  // Update Inventory in database
  event.ticketsSold += qty;

  // Record Ticket
  db.tickets.unshift(newTicket);
  saveDB(db);
  
  // Envoi de l'email
  await sendTicketEmail(newTicket);

  // Notification organisateur (best-effort, ne doit jamais bloquer la réponse)
  try {
    const organizerUser = db.users.find((u: any) => u.id === event.organizerId);
    await sendOrganizerSaleEmail(organizerUser?.email, event.organizerName, event.title, newTicket);
  } catch (e: any) {
    console.warn("[Email] Notification organisateur (vente) échouée :", e.message);
  }

  res.status(201).json({
    success: true,
    message: "Achat de billet effectué avec succès !",
    ticket: newTicket,
    notificationUrl: buildWebhookNotificationUrl(req)
  });
});

// Webhook Supabase Database Webhook : déclenché sur INSERT dans public.users,
// envoie l'email de bienvenue (+ notification admin si organisateur).
// Sécurisé par un secret partagé transmis via le header Authorization, configuré
// côté Supabase (Dashboard > Database > Webhooks) en plus de l'en-tête HTTP.
app.post("/api/webhooks/supabase/new-user", async (req: express.Request, res: express.Response) => {
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

  try {
    await sendWelcomeEmail({ email: record.email, name: record.name, role: record.role });
    if (record.role === "organizer") {
      await sendAdminNewOrganizerEmail({ name: record.name, email: record.email });
    }
  } catch (err: any) {
    console.error("[Supabase Webhook] Erreur lors de l'envoi des emails de bienvenue :", err.message || err);
  }

  res.status(200).json({ status: "success" });
});

// Callback / Webhook endpoint pour recevoir les notifications de Paiement Pro (CI)
function normalizeReferenceIdentifier(value: any): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.split(/[?&]/)[0].trim();
}

app.options("/api/payment/callback", (req: express.Request, res: express.Response) => {
  const origin = corsAllowedOrigin(req);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-PaiementPro-Signature, X-Signature, X-Webhook-Signature");
  return res.status(200).end();
});

app.post("/api/payment/callback", async (req: express.Request, res: express.Response) => {
  const origin = corsAllowedOrigin(req);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-PaiementPro-Signature, X-Signature, X-Webhook-Signature");

  const providedWebhookSecret = getWebhookSecretFromRequest(req);
  if (!PAYMENT_WEBHOOK_SECRET) {
    console.error("[PaiementPro Callback] PAYMENT_WEBHOOK_SECRET non configuré.");
    return res.status(500).json({ status: "error", message: "Webhook secret manquant." });
  }

  if (providedWebhookSecret !== PAYMENT_WEBHOOK_SECRET) {
    console.warn("[PaiementPro Callback] Tentative rejetée : token webhook absent ou invalide.", {
      providedWebhookSecret,
      ip: req.ip,
      query: req.query
    });
    return res.status(401).json({ status: "error", message: "Non autorisé." });
  }

  console.log("=== CALLBACK PAIEMENT PRO REÇU ===");
  console.log("Headers:", req.headers);
  console.log("Body reçu:", req.body);
  console.log("Query parameters:", req.query);

  if (PAYMENT_PRO_CALLBACK_SECRET && !verifyPaymentSignature(req)) {
    console.error("[PaiementPro Callback] Signature invalide ou absente.");
    return res.status(401).json({ status: "error", message: "Signature invalide." });
  }

  // Extraction des données classiques envoyées par Paiement Pro
  const rawReferenceNumber = req.body.referenceNumber || req.query.referenceNumber || req.body.reference || req.query.reference || req.body.reference_number || req.query.reference_number || req.body.ref_command || req.query.ref_command || req.body.id || req.body.custom || req.query.custom || req.body.transaction_id || req.body.ticket_id || req.query.ticket_id;
  const status = req.body.status || req.query.status || req.body.response_code || req.query.response_code || req.body.statut;

  const referenceNumber = normalizeReferenceIdentifier(rawReferenceNumber);
  const rawReferenceNumberDisplay = String(rawReferenceNumber ?? "").trim();

  console.log(`[PaiementPro] Raw reference : ${rawReferenceNumberDisplay}`);
  console.log(`[PaiementPro] Normalized referenceNumber : ${referenceNumber}`);

  if (!referenceNumber) {
    console.error("Erreur : Données de ciblage manquantes dans le body");
    return res.status(400).json({ status: "error", message: "referenceNumber ou champ d'identifiant manquant" });
  }

  console.log(`[PaiementPro] Traitement du paiement pour la référence : ${referenceNumber}, statut reçu : ${status}`);

  const normalizedStatus = typeof status === "string" ? status.toLowerCase() : status;

  // Try to read numeric response code sent by some providers (responsecode, response_code, responseCode)
  const rawResponseCode = req.body.responsecode ?? req.query.responsecode ?? req.body.response_code ?? req.query.response_code ?? req.body.responseCode ?? req.query.responseCode;
  const numericResponseCode = rawResponseCode !== undefined && rawResponseCode !== null && rawResponseCode !== "" ? Number(String(rawResponseCode).replace(/[^0-9\-]/g, "")) : null;

  let isSuccess: boolean;
  if (numericResponseCode !== null && !Number.isNaN(numericResponseCode)) {
    isSuccess = numericResponseCode === 0;
  } else {
    isSuccess = normalizedStatus === "success" || normalizedStatus === "paid" || req.body.success === true;
  }

  console.log(`[PaiementPro] Raw response code: ${rawResponseCode} -> numeric: ${numericResponseCode}, interpreted success: ${isSuccess}`);

  let supabaseTicketFound = false;
  if (isSupabaseEnabled && supabase) {
    try {
      const refCandidates = [referenceNumber];
      if (rawReferenceNumberDisplay && rawReferenceNumberDisplay !== referenceNumber) {
        refCandidates.push(rawReferenceNumberDisplay);
      }

      for (const ref of refCandidates) {
        if (!ref) continue;
        console.log(`[PaiementPro Callback] Tentative de recherche Supabase pour référence candidate: ${ref}`);
        const { data: ticket, error: fetchErr } = await supabase
          .from("tickets")
          .select("*")
          .or(`id.eq.${ref},transaction_ref.eq.${ref}`)
          .maybeSingle();

        if (fetchErr || !ticket) {
          console.warn(`[PaiementPro Callback] Ticket introuvable dans Supabase pour la référence : ${ref}`);
          continue;
        }

        supabaseTicketFound = true;
        console.log(`[PaiementPro Callback] Ticket trouvé dans Supabase: id=${ticket.id}, event=${ticket.event_title}, transaction_ref=${ticket.transaction_ref}`);

        if (!isSuccess) {
          console.log(`[PaiementPro Callback] Réception d'un callback NON-succès pour ticket id=${ticket.id} (responsecode=${numericResponseCode}). Aucune mise à jour effectuée.`);
          sendPaymentFailedEmail(ticket).catch(() => {});
        } else {
          const newRef = String(ticket.transaction_ref || "").replace("PENDING-", "PAID-");
          console.log(`[PaiementPro Callback] Mise à jour Supabase ticket id=${ticket.id} -> transaction_ref: ${ticket.transaction_ref} => ${newRef}`);
          try {
            const { data: updated, error: updateErr } = await supabase.from("tickets")
              .update({ transaction_ref: newRef })
              .eq("id", ticket.id)
              .select()
              .single();

            if (updateErr) {
              console.error(`[PaiementPro Callback] Erreur lors de la mise à jour Supabase pour id=${ticket.id}:`, updateErr.message || updateErr);
            } else {
              console.log(`[PaiementPro Callback] Mise à jour Supabase réussie pour id=${ticket.id}.`);
            }
          } catch (uErr: any) {
            console.error(`[PaiementPro Callback] Exception lors de la mise à jour Supabase pour id=${ticket.id}:`, uErr.message || uErr);
          }
        }

        break;
      }
    } catch (err: any) {
      console.error("[PaiementPro Callback Supabase Error]", err.message);
    }
  }

  if (!supabaseTicketFound) {
    const db = getDB();
    const ticket = db.tickets.find(t => [referenceNumber, rawReferenceNumberDisplay].some(ref => ref && (t.id === ref || t.transactionRef === ref)));
    if (!ticket) {
      console.warn(`[PaiementPro Callback] Ticket local introuvable pour la référence : ${referenceNumber}`);
    } else {
      console.log(`[PaiementPro Callback] Ticket local trouvé: id=${ticket.id}, buyer=${ticket.buyerName}, transactionRef=${ticket.transactionRef}`);
      if (!isSuccess) {
        console.log(`[PaiementPro Callback] Callback NON-succès reçu pour ticket id=${ticket.id} (rawResponseCode=${rawResponseCode}). Aucune modification locale appliquée.`);
        sendPaymentFailedEmail(ticket).catch(() => {});
      } else {
        const oldRef = ticket.transactionRef || "";
        const newRef = String(oldRef).replace("PENDING-", "PAID-");
        ticket.transactionRef = newRef;
        saveDB(db);
        console.log(`[PaiementPro Callback] Ticket local mis à jour: id=${ticket.id}, transactionRef: ${oldRef} -> ${newRef}`);
      }
    }
  }

  res.status(200).json({ status: "success", message: "Notification traitée" });
});

app.post("/api/dev/simulate-payment", async (req: express.Request, res: express.Response) => {
  if (process.env.NODE_ENV === "production") {
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

  let updated = false;
  if (isSupabaseEnabled && supabase) {
    try {
      const { data: ticket, error: fetchErr } = await supabase.from("tickets")
        .select("*")
        .or(`id.eq.${rawReferenceNumber},transaction_ref.eq.${rawReferenceNumber}`)
        .maybeSingle();

      if (ticket && !fetchErr) {
        updated = true;
        await supabase.from("tickets").update({ transaction_ref: String(ticket.transaction_ref || "").replace("PENDING-", "PAID-") }).eq("id", ticket.id);
      }
    } catch (err: any) {
      console.error("[Dev Simulation] Erreur Supabase lors de la simulation de paiement :", err.message || err);
    }
  }

  if (!updated) {
    const db = getDB();
    const ticket = db.tickets.find((t: any) => t.id === rawReferenceNumber || t.transactionRef === rawReferenceNumber);
    if (ticket) {
      ticket.transactionRef = String(ticket.transactionRef || "").replace("PENDING-", "PAID-");
      saveDB(db);
      updated = true;
    }
  }

  if (!updated) {
    return res.status(404).json({ error: "Billet introuvable pour simulation." });
  }

  res.json({ success: true, message: "Simulation de paiement effectuée." });
});

// Ticket Verification Endpoint (QR Scanning Verification)
app.post("/api/verify-ticket", validateVerifyTicket, async (req: express.Request, res: express.Response) => {
  const { qrCodeData, organizerId } = req.body;

  if (!qrCodeData) {
    return res.status(400).json({ error: "Code QR invalide ou manquant." });
  }

  const match = qrCodeData.match(/^clicbillet-verify:(tkt-[a-zA-Z0-9\-]+)$/);
  if (!match) {
    return res.status(400).json({ error: "Ce code QR n'est pas un billet valide ClicBillet." });
  }

  const ticketId = match[1];

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: ticket, error } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", ticketId)
        .maybeSingle();

      if (error || !ticket) {
        return res.status(404).json({ error: "Billet introuvable dans notre système de sécurité." });
      }

      const mappedTicket = {
        id: ticket.id,
        eventId: ticket.event_id,
        eventTitle: ticket.event_title,
        eventDate: ticket.event_date,
        eventTime: ticket.event_time,
        eventVenue: ticket.event_venue,
        buyerId: ticket.buyer_id,
        buyerName: ticket.buyer_name,
        buyerEmail: ticket.buyer_email,
        tier: ticket.tier,
        pricePaid: Number(ticket.price_paid),
        qrCodeData: ticket.qr_code_data,
        scanned: ticket.scanned,
        scannedAt: ticket.scanned_at,
        transactionRef: ticket.transaction_ref,
        purchaseDate: ticket.purchase_date,
        quantity: ticket.quantity
      };

      if (ticket.scanned) {
        return res.status(200).json({
          success: false,
          alreadyScanned: true,
          scannedAt: ticket.scanned_at,
          ticket: mappedTicket
        });
      }

      // Mark as verified
      const verifiedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("tickets")
        .update({
          scanned: true,
          scanned_at: verifiedAt
        })
        .eq("id", ticketId);

      if (updateError) throw updateError;

      mappedTicket.scanned = true;
      mappedTicket.scannedAt = verifiedAt;

      return res.json({
        success: true,
        alreadyScanned: false,
        ticket: mappedTicket
      });
    } catch (err: any) {
      console.error("[Supabase Error] Verification, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const ticket = db.tickets.find((t: any) => t.id === ticketId);

  if (!ticket) {
    return res.status(404).json({ error: "Billet introuvable dans notre système de sécurité." });
  }

  // Cross-verify: Wait, is the organizer allowed to scan this? Yes, any registered organizer can inspect tickets!
  if (ticket.scanned) {
    return res.status(200).json({
      success: false,
      alreadyScanned: true,
      scannedAt: ticket.scannedAt,
      ticket
    });
  }

  // Mark as verified
  ticket.scanned = true;
  ticket.scannedAt = new Date().toISOString();
  saveDB(db);

  res.json({
    success: true,
    alreadyScanned: false,
    ticket
  });
});

// Statistics Endpoint for Organizers
app.get("/api/organizer/export", requireRole("organizer", "admin"), async (req: express.Request, res: express.Response) => {
  const authUser = (req as any).user;
  const requestedOrganizerId = String(req.query.organizerId || authUser.id || "");

  if (authUser.role !== "admin" && requestedOrganizerId !== authUser.id) {
    return res.status(403).json({ error: "Accès refusé : vous ne pouvez exporter que vos propres événements." });
  }

  try {
    let matchedTickets: any[] = [];
    const backendClient = supabaseAdmin || supabase;
    if (backendClient) {
      const { data: organizerEvents, error: eventsError } = await backendClient
        .from("events")
        .select("id")
        .eq("organizer_id", requestedOrganizerId);
      if (eventsError) throw eventsError;
      
      const eventIds = (organizerEvents || []).map((e: any) => e.id);
      if (eventIds.length > 0) {
        const { data: tkts, error: tktsError } = await supabase
          .from("tickets")
          .select("*")
          .in("event_id", eventIds)
          .order("purchase_date", { ascending: false });
        if (tktsError) throw tktsError;
        matchedTickets = tkts || [];
      }
    } else {
      const db = getDB();
      const organizerEvents = db.events.filter((e: any) => e.organizerId === requestedOrganizerId);
      const eventIds = organizerEvents.map((e: any) => e.id);
      matchedTickets = db.tickets.filter((t: any) => eventIds.includes(t.eventId));
    }
    
    // Generate CSV
    const header = [
      "ID Transaction",
      "Date d'Achat",
      "Événement",
      "Client",
      "Email Client",
      "Quantité",
      "Catégorie",
      "Prix Payé (XOF)",
      "Statut"
    ].join(",");

    const rows = matchedTickets.map((t: any) => [
      t.transaction_ref || t.transactionRef || "",
      t.purchase_date || t.purchaseDate || "",
      `"${(t.event_title || t.eventTitle || "").replace(/"/g, '""')}"`,
      `"${(t.buyer_name || t.buyerName || "").replace(/"/g, '""')}"`,
      `"${(t.buyer_email || t.buyerEmail || "").replace(/"/g, '""')}"`,
      t.quantity || 1,
      t.tier || "standard",
      t.price_paid || t.pricePaid || 0,
      t.payment_status || t.paymentStatus || "paid"
    ].join(","));

    const csvData = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="clicbillet_export_${Date.now()}.csv"`);
    res.status(200).send(csvData);
  } catch (err: any) {
    console.error("Export error", err);
    res.status(500).json({ error: "Erreur lors de l'exportation." });
  }
});

app.get("/api/organizer/stats", async (req: express.Request, res: express.Response) => {
  const { organizerId } = req.query;

  if (!organizerId) {
    return res.status(400).json({ error: "organizerId requis." });
  }

  if (supabase) {
    try {
      const backendClient = supabaseAdmin || supabase;
      // 1. Get organizer events
      const { data: organizerEvents, error: eventsError } = await backendClient
        .from("events")
        .select("*")
        .eq("organizer_id", organizerId);

      if (eventsError) throw eventsError;

      const eventIds = (organizerEvents || []).map((e: any) => e.id);

      // 2. Get tickets for those events
      let matchedTickets: any[] = [];
      if (eventIds.length > 0) {
        const { data: tkts, error: tktsError } = await supabase
          .from("tickets")
          .select("*")
          .in("event_id", eventIds)
          .order("purchase_date", { ascending: false });

        if (tktsError) throw tktsError;
        matchedTickets = tkts || [];
      }

      const totalGrossRevenue = matchedTickets.reduce((sum: number, t: any) => sum + Number(t.price_paid || 0), 0);
      const commissionRate = 0.10;
      const totalCommission = Math.floor(totalGrossRevenue * commissionRate);
      const totalRevenue = totalGrossRevenue - totalCommission;
      
      const ticketsSold = matchedTickets.reduce((sum: number, t: any) => sum + Number(t.quantity || 1), 0);
      const activeEvents = (organizerEvents || []).length;

      const recentSales = matchedTickets.slice(0, 10).map((t: any) => ({
        eventTitle: t.event_title,
        buyerName: t.buyer_name,
        amount: Number(t.price_paid),
        date: t.purchase_date,
        tier: t.tier
      }));

      const tickets = matchedTickets.map((t: any) => ({
        id: t.id,
        eventId: t.event_id,
        eventTitle: t.event_title,
        buyerName: t.buyer_name,
        buyerEmail: t.buyer_email,
        tier: t.tier,
        pricePaid: Number(t.price_paid),
        scanned: t.scanned,
        scannedAt: t.scanned_at,
        transactionRef: t.transaction_ref,
        purchaseDate: t.purchase_date,
        quantity: t.quantity
      }));

      return res.json({
        totalRevenue,
        totalGrossRevenue,
        totalCommission,
        commissionRate,
        ticketsSold,
        activeEvents,
        recentSales,
        tickets
      });
    } catch (err: any) {
      console.error("[Supabase Error] Organizer statistics, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  
  // Custom filter if and only if organizer created it. (For fallback simulation let's grant view of all tickets of their events!)
  const organizerEvents = db.events.filter((e: any) => e.organizerId === organizerId);
  const eventIds = organizerEvents.map((e: any) => e.id);

  const matchedTickets = db.tickets.filter((t: any) => eventIds.includes(t.eventId));

  const totalGrossRevenue = matchedTickets.reduce((sum: number, t: any) => sum + t.pricePaid, 0);
  const commissionRate = 0.10; // 10% ClicBillet Plateforme Commission
  const totalCommission = Math.floor(totalGrossRevenue * commissionRate);
  const totalRevenue = totalGrossRevenue - totalCommission; // Le solde chez l'organisateur (après déduction)
  
  const ticketsSold = matchedTickets.reduce((sum: number, t: any) => sum + t.quantity, 0);
  const activeEvents = organizerEvents.length;

  const recentSales = matchedTickets.slice(0, 10).map((t: any) => ({
    eventTitle: t.eventTitle,
    buyerName: t.buyerName,
    amount: t.pricePaid,
    date: t.purchaseDate,
    tier: t.tier
  }));

  res.json({
    totalRevenue, // Net Balance
    totalGrossRevenue, // Gross 100%
    totalCommission, // 10% platform share
    commissionRate,
    ticketsSold,
    activeEvents,
    recentSales,
    tickets: matchedTickets
  });
});

// Update/Modify Event Endpoint
app.put("/api/events/:id", validateEvent, async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { title, description, date, time, price, ticketTypes, venue, category, banner, totalTickets, organizerId } = req.body;

  if (!title || !date || !time || isNaN(price) || !venue || !category || !totalTickets) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires correctement." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: originalEvent, error: fetchErr } = await supabase
        .from("events")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr || !originalEvent) {
        return res.status(404).json({ error: "Événement introuvable." });
      }

      if (organizerId && originalEvent.organizer_id !== organizerId && organizerId !== "usr-admin") {
        return res.status(403).json({ error: "Vous n'êtes pas autorisé à modifier cet événement." });
      }

      const bannerUrl = banner || originalEvent.banner;
      const { data, error } = await supabase
        .from("events")
        .update({
          title,
          description: description || "Aucune description fournie.",
          date,
          time,
          price: Number(price),
          ticket_types: ticketTypes,
          venue,
          category,
          banner: bannerUrl,
          total_tickets: Number(totalTickets)
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Update associated tickets as well
      const { error: ticketSyncErr } = await supabase
        .from("tickets")
        .update({
          event_title: title,
          event_date: date,
          event_time: time,
          event_venue: venue
        })
        .eq("event_id", id);

      if (ticketSyncErr) {
        console.warn("Supabase Warning syncing tickets:", ticketSyncErr.message);
      }

      const mappedEvent = {
        id: data.id,
        title: data.title,
        description: data.description,
        date: data.date,
        time: data.time,
        price: Number(data.price),
        ticketTypes: data.ticket_types,
        venue: data.venue,
        category: data.category,
        banner: data.banner,
        ticketsSold: data.tickets_sold,
        totalTickets: data.total_tickets,
        organizerId: data.organizer_id,
        organizerName: data.organizer_name
      };

      return res.json({ success: true, message: "Événement modifié avec succès !", event: mappedEvent });
    } catch (err: any) {
      console.error("[Supabase Error] Event update, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const event = db.events.find(e => e.id === id);

  if (!event) {
    return res.status(404).json({ error: "Événement introuvable." });
  }

  // Security check: must belong to correct organizer unless it is admin
  if (organizerId && event.organizerId !== organizerId && organizerId !== "usr-admin") {
    return res.status(403).json({ error: "Vous n'êtes pas autorisé à modifier cet événement." });
  }

  event.title = title;
  event.description = description || "Aucune description fournie.";
  event.date = date;
  event.time = time;
  event.price = Number(price);
  event.ticketTypes = ticketTypes;
  event.venue = venue;
  event.category = category;
  if (banner) {
    event.banner = banner;
  }
  event.totalTickets = Number(totalTickets);

  saveDB(db);

  // Sync event values into tickets as well if they exist
  db.tickets.forEach(t => {
    if (t.eventId === id) {
      t.eventTitle = title;
      t.eventDate = date;
      t.eventTime = time;
      t.eventVenue = venue;
    }
  });
  saveDB(db);

  res.json({ success: true, message: "Événement modifié avec succès !", event });
});

// Admin-specific Management APIs
app.get("/api/admin/stats", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data: users, error: uErr } = await adminClient.from("users").select("*");
      const { data: events, error: eErr } = await adminClient.from("events").select("*");
      const { data: tickets, error: tErr } = await adminClient.from("tickets").select("*");

      if (uErr) throw uErr;
      if (eErr) throw eErr;
      if (tErr) throw tErr;

      const matchedTickets = tickets || [];
      const totalRevenue = matchedTickets.reduce((sum: number, t: any) => sum + Number(t.price_paid || 0), 0);
      const commissionRate = 0.10;
      const totalPlatformCommission = Math.floor(totalRevenue * commissionRate);
      const totalOrganizerPayout = totalRevenue - totalPlatformCommission;

      const totalTicketsSold = matchedTickets.reduce((sum: number, t: any) => sum + Number(t.quantity || 1), 0);
      const totalUsers = (users || []).length;
      const totalEvents = (events || []).length;

      const mappedUsers = (users || []).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
      const mappedEvents = (events || []).map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        date: e.date,
        time: e.time,
        price: Number(e.price),
        venue: e.venue,
        category: e.category,
        banner: e.banner,
        ticketsSold: e.tickets_sold ?? 0,
        totalTickets: e.total_tickets,
        organizerId: e.organizer_id,
        organizerName: e.organizer_name,
        status: e.status || "approved"
      }));
      const mappedTickets = matchedTickets.map(t => ({
        id: t.id,
        eventId: t.event_id,
        eventTitle: t.event_title,
        eventDate: t.event_date,
        eventTime: t.event_time,
        eventVenue: t.event_venue,
        buyerId: t.buyer_id,
        buyerName: t.buyer_name,
        buyerEmail: t.buyer_email,
        tier: t.tier,
        pricePaid: Number(t.price_paid),
        qrCodeData: t.qr_code_data,
        scanned: t.scanned,
        scannedAt: t.scanned_at,
        transactionRef: t.transaction_ref,
        purchaseDate: t.purchase_date,
        quantity: t.quantity,
        paymentStatus: t.transaction_ref?.startsWith("PENDING-") ? "pending" : "paid"
      }));

      return res.json({
        totalRevenue,
        totalPlatformCommission,
        totalOrganizerPayout,
        commissionRate,
        totalTicketsSold,
        totalUsers,
        totalEvents,
        users: mappedUsers,
        events: mappedEvents,
        tickets: mappedTickets
      });
    } catch (err: any) {
      console.error("[Supabase Error] Admin stats, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const totalRevenue = db.tickets.reduce((sum: number, t: any) => sum + t.pricePaid, 0); // Total Gross XOF
  const commissionRate = 0.10;
  const totalPlatformCommission = Math.floor(totalRevenue * commissionRate); // Total collected by platform
  const totalOrganizerPayout = totalRevenue - totalPlatformCommission;
  
  const totalTicketsSold = db.tickets.reduce((sum: number, t: any) => sum + t.quantity, 0);
  const totalUsers = db.users.length;
  const totalEvents = db.events.length;

  res.json({
    totalRevenue, // Gross
    totalPlatformCommission, // Commission collected by ClicBillet
    totalOrganizerPayout, // Net given out
    commissionRate,
    totalTicketsSold,
    totalUsers,
    totalEvents,
    users: db.users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    events: db.events,
    tickets: db.tickets.map(t => ({
      ...t,
      paymentStatus: t.transactionRef?.startsWith("PENDING-") ? "pending" : "paid"
    }))
  });
});

app.post("/api/admin/validate-payment", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  const { referenceNumber } = req.body;
  if (!referenceNumber) {
    return res.status(400).json({ error: "Référence ou ID du billet manquant." });
  }

  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data: ticket, error: fetchErr } = await adminClient.from("tickets")
        .select()
        .or(`id.eq.${referenceNumber},transaction_ref.eq.${referenceNumber}`)
        .single();
      
      if (fetchErr || !ticket) {
        throw new Error("Billet introuvable dans Supabase.");
      }

      const { error: updateErr } = await supabase.from("tickets")
        .update({ transaction_ref: ticket.transaction_ref.replace("PENDING-", "PAID-") })
        .eq("id", ticket.id);

      if (updateErr) throw updateErr;

      return res.json({ success: true, message: "Paiement validé avec succès." });
    } catch (err: any) {
      console.error("[Supabase Error] Manual validation, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const ticket = db.tickets.find(t => t.id === referenceNumber || t.transactionRef === referenceNumber);
  
  if (!ticket) {
    return res.status(404).json({ error: "Billet introuvable." });
  }

  ticket.transactionRef = ticket.transactionRef.replace("PENDING-", "PAID-");
  saveDB(db);

  res.json({ success: true, message: "Paiement validé localement." });
});

app.delete("/api/admin/events/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const adminClient = supabaseAdmin;

  if (adminClient) {
    try {
      const { error } = await adminClient
        .from("events")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return res.json({ success: true, message: "Événement de la plateforme supprimé avec succès." });
    } catch (err: any) {
      console.error("[Supabase Error] Deleting event, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const index = db.events.findIndex(e => e.id === id);
  if (index !== -1) {
    db.events.splice(index, 1);
    saveDB(db);
    return res.json({ success: true, message: "Événement de la plateforme supprimé avec succès." });
  }
  res.status(404).json({ error: "Événement introuvable." });
});

app.delete("/api/admin/users/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  if (id === "usr-admin") {
    return res.status(400).json({ error: "Le compte administrateur principal ne peut pas être révoqué ou supprimé." });
  }

  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { error } = await adminClient
        .from("users")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return res.json({ success: true, message: "Compte utilisateur révoqué avec succès." });
    } catch (err: any) {
      console.error("[Supabase Error] Deleting user, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const index = db.users.findIndex(u => u.id === id);
  if (index !== -1) {
    db.users.splice(index, 1);
    saveDB(db);
    return res.json({ success: true, message: "Compte utilisateur révoqué avec succès." });
  }
  res.status(404).json({ error: "Utilisateur introuvable." });
});

// --- Modération Events ---
app.patch("/api/admin/events/:id/status", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status || !["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Statut invalide" });

  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data: updatedEvent, error } = await adminClient.from("events").update({ status }).eq("id", id).select().maybeSingle();
      if (error) {
         if (error.message.includes('status')) {
            throw new Error('Supabase column events.status is missing. Update supabase_setup.sql');
         }
         throw error;
      }

      if (updatedEvent) {
        try {
          const { data: organizerUser } = await adminClient
            .from("users")
            .select("email")
            .eq("id", updatedEvent.organizer_id)
            .maybeSingle();
          await sendOrganizerEventStatusEmail(organizerUser?.email, updatedEvent.organizer_name, updatedEvent.title, status);
        } catch (e: any) {
          console.warn("[Email] Notification organisateur (statut événement) échouée :", e.message);
        }
      }

      return res.json({ success: true, message: `Événement ${status}` });
    } catch(e: any) {
      console.warn("[Supabase Error] Admin event status update:", e.message);
    }
  }

  const db = getDB();
  const event = db.events.find(e => e.id === id);
  if (event) {
    event.status = status;
    saveDB(db);

    try {
      const organizerUser = db.users.find((u: any) => u.id === event.organizerId);
      sendOrganizerEventStatusEmail(organizerUser?.email, event.organizerName, event.title, status).catch(() => {});
    } catch (e: any) {
      console.warn("[Email] Notification organisateur (statut événement) échouée :", e.message);
    }

    return res.json({ success: true, message: `Événement ${status}` });
  }
  res.status(404).json({ error: "Événement introuvable" });
});

// --- Payouts (Demandes de retrait) ---
app.post("/api/organizer/payouts", async (req: express.Request, res: express.Response) => {
  const { organizerId, amount, method, details } = req.body;
  if (!organizerId || !amount || !method) return res.status(400).json({ error: "Champs manquants" });

  const payout = {
    id: `pay-${Date.now()}`, organizerId, amount: Number(amount), status: "pending" as const,
    requestDate: new Date().toISOString(), method, details
  };

  const backendClient = supabaseAdmin || supabase;
  if (backendClient) {
    try {
      const { error } = await backendClient.from("payouts").insert({
        id: payout.id, organizer_id: payout.organizerId, amount: payout.amount,
        status: payout.status, request_date: payout.requestDate, method: payout.method, details: payout.details
      });
      if (error) throw error;
    } catch(e: any) {
       console.warn("[Supabase Error] Payout insert, falling back to local file DB:", e.message);
    }
  }
  const db = getDB();
  db.payouts = db.payouts || [];
  db.payouts.unshift(payout as any);
  saveDB(db);

  try {
    let organizerName = db.users.find((u: any) => u.id === organizerId)?.name;
    if (!organizerName && backendClient) {
      const { data: organizerUser } = await backendClient.from("users").select("name").eq("id", organizerId).maybeSingle();
      organizerName = organizerUser?.name;
    }
    sendAdminPayoutRequestEmail(organizerName || organizerId, payout).catch(() => {});
  } catch (e: any) {
    console.warn("[Email] Notification admin (demande de retrait) échouée :", e.message);
  }

  res.json({ success: true, payout });
});

app.get("/api/organizer/payouts", async (req: express.Request, res: express.Response) => {
  const { organizerId } = req.query;
  const backendClient = supabaseAdmin || supabase;
  if (backendClient) {
    try {
      const { data, error } = await backendClient.from("payouts").select("*").eq("organizer_id", organizerId);
      if (!error) return res.json(data.map((p: any) => ({...p, organizerId: p.organizer_id, requestDate: p.request_date})));
    } catch(e) {}
  }
  const db = getDB();
  res.json((db.payouts || []).filter(p => p.organizerId === organizerId || (p as any).organizer_id === organizerId));
});

app.get("/api/admin/payouts", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data, error } = await adminClient.from("payouts").select("*").order("request_date", { ascending: false });
      if (!error) return res.json(data.map((p: any) => ({...p, organizerId: p.organizer_id, requestDate: p.request_date})));
    } catch(e) {}
  }
  const db = getDB();
  res.json(db.payouts || []);
});

app.patch("/api/admin/payouts/:id/status", async (req: express.Request, res: express.Response) => {
  const { status } = req.body;
  if (isSupabaseEnabled && supabase) {
    try {
      const { data: updatedPayout, error } = await supabase.from("payouts").update({ status }).eq("id", req.params.id).select().maybeSingle();
      if (!error) {
        if (updatedPayout) {
          try {
            const { data: organizerUser } = await supabase.from("users").select("email,name").eq("id", updatedPayout.organizer_id).maybeSingle();
            const mappedPayout = { ...updatedPayout, organizerId: updatedPayout.organizer_id, requestDate: updatedPayout.request_date };
            await sendOrganizerPayoutStatusEmail(organizerUser?.email, organizerUser?.name || updatedPayout.organizer_id, mappedPayout);
          } catch (e: any) {
            console.warn("[Email] Notification organisateur (statut retrait) échouée :", e.message);
          }
        }
        return res.json({ success: true });
      }
    } catch(e) {}
  }
  const db = getDB();
  db.payouts = db.payouts || [];
  const p = db.payouts.find(p => p.id === req.params.id);
  if (p) {
    p.status = status;
    saveDB(db);

    try {
      const organizerUser = db.users.find((u: any) => u.id === (p as any).organizerId);
      sendOrganizerPayoutStatusEmail(organizerUser?.email, organizerUser?.name || (p as any).organizerId, p).catch(() => {});
    } catch (e: any) {
      console.warn("[Email] Notification organisateur (statut retrait) échouée :", e.message);
    }

    return res.json({ success: true });
  }
  res.status(404).json({ error: "Introuvable" });
});

// --- Transactions History ---
app.get("/api/admin/transactions", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data, error } = await adminClient.from("transactions").select("*").order("date", { ascending: false });
      if (!error) return res.json(data.map((t: any) => ({...t, eventId: t.event_id, buyerEmail: t.buyer_email, errorDetails: t.error_details})));
    } catch(e) {}
  }
  const db = getDB();
  res.json(db.transactions || []);
});

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
