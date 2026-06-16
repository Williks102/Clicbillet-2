import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Emulate __dirname/__filename for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase Connection initialization with graceful safety checks and auto-correction of user typos
const allEnvValues = [
  process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_ANON_KEY,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
].map(val => (val || "").trim()).filter(Boolean);

let rawSupabaseUrl = "";
let supabaseServiceKey = "";

// Smart search: Find the value that is actually an HTTP/HTTPS URL
for (const val of allEnvValues) {
  const cleaned = val.replace(/\s+/g, "");
  if (/^https?:\/\//i.test(cleaned)) {
    rawSupabaseUrl = cleaned;
    break;
  }
}

// Smart search: Find the value that looks like a Supabase API key (starts with sb_ or JWT signature 'eyJ')
for (const val of allEnvValues) {
  const cleaned = val.replace(/\s+/g, "");
  if (cleaned !== rawSupabaseUrl && (cleaned.startsWith("sb_") || cleaned.startsWith("eyJ"))) {
    supabaseServiceKey = cleaned;
    break;
  }
}

// Fallback to classic sequential resolution if smart detection didn't find clear pairs
if (!rawSupabaseUrl) {
  const possibleUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\s+/g, "");
  if (/^https?:\/\//i.test(possibleUrl)) {
    rawSupabaseUrl = possibleUrl;
  }
}
if (!supabaseServiceKey) {
  supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim().replace(/\s+/g, "");
}

let isSupabaseEnabled = false;
let supabase: any = null;

if (rawSupabaseUrl && supabaseServiceKey) {
  if (/^https?:\/\//i.test(rawSupabaseUrl)) {
    try {
      supabase = createClient(rawSupabaseUrl, supabaseServiceKey);
      isSupabaseEnabled = true;
      console.log("==================================================");
      console.log(`[Supabase] Activé ! Connexion en cours vers : ${rawSupabaseUrl}`);
      console.log("==================================================");
    } catch (err: any) {
      console.error("==================================================");
      console.error("[Supabase Error] Échec de l'initialisation du client :", err.message);
      console.error("[Supabase] Repli automatique sur : db.json");
      console.error("==================================================");
    }
  } else {
    console.warn("==================================================");
    console.warn("[Supabase Warning] L'URL Supabase configurée semble invalide (n'est pas une URL HTTP/HTTPS) :", rawSupabaseUrl);
    console.warn("[Supabase] Repli automatique sur : db.json");
    console.warn("==================================================");
  }
} else {
  console.log("==================================================");
  console.log("[Supabase] Configuration absente ou incomplète (URL ou Clé manquante).");
  console.log("[Supabase] Repli automatique sur la base locale : db.json");
  console.log("==================================================");
}

const app = express();
const PORT = 3000;

// Path to durable local JSON Database
const DB_FILE = path.join(process.cwd(), "db.json");

// Define basic initial DB structure
const INITIAL_DATABASE = {
  users: [
    {
      id: "usr-admin",
      email: "admin@clicbillet.ci",
      password: "password123",
      name: "Administrateur ClicBillet",
      role: "admin"
    },
    {
      id: "usr-client",
      email: "client@clicbillet.ci",
      password: "password123",
      name: "Jean-Eudes Koffi",
      role: "client"
    },
    {
      id: "org-1",
      email: "orga@clicbillet.ci",
      password: "password123",
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
  ]
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
        password: "password123",
        name: "Administrateur ClicBillet",
        role: "admin"
      });
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
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

// Enable JSON parsing middleware
app.use(express.json());

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
    return obj.map(item => sanitizeObject(item));
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
app.use((req, res, next) => {
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
  const { eventId, buyerId, buyerName, buyerEmail, tier, quantity, paymentDetails } = req.body;

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
app.get("/api/events", async (req, res) => {
  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Map snake_case columns back to camelCase frontend expectations
      const mappedEvents = (data || []).map((e: any) => ({
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
        organizerName: e.organizer_name
      }));
      return res.json(mappedEvents);
    } catch (err: any) {
      console.error("[Supabase Error] Fetching events, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  res.json(db.events);
});

// Create Event Endpoint for Organizers
app.post("/api/events", validateEvent, async (req, res) => {
  const { title, description, date, time, price, venue, category, banner, totalTickets, organizerId, organizerName } = req.body;

  if (!title || !date || !time || isNaN(price) || !venue || !category || !totalTickets || !organizerId) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires correctement." });
  }

  const newEventId = `evt-${Date.now()}`;
  const bannerUrl = banner || "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&auto=format&fit=crop&q=60";

  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("events")
        .insert({
          id: newEventId,
          title,
          description: description || "Aucune description fournie.",
          date,
          time,
          price: Number(price),
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

      if (error) throw error;

      const mappedEvent = {
        id: data.id,
        title: data.title,
        description: data.description,
        date: data.date,
        time: data.time,
        price: Number(data.price),
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
app.post("/api/auth/register", validateRegister, async (req, res) => {
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
        const { data: adminData, error: adminError } = await supabase.auth.admin.createUser({
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
      } catch (adminException) {
        isSignUpFallbackNeeded = true;
      }

      if (isSignUpFallbackNeeded) {
        // Fallback to client-side signUp if the service role key is not active on this environment
        const { data: clientData, error: clientError } = await supabase.auth.signUp({
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

      return res.status(201).json({
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role
      });
    } catch (err: any) {
      console.error("[Supabase Error] User registration, falling back to local file DB:", err.message);
    }
  }

  // Fallback Database
  const db = getDB();
  const exists = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: "Un utilisateur avec cet e-mail existe déjà." });
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    email: email.toLowerCase(),
    password,
    name,
    role: role === "organizer" ? ("organizer" as const) : ("client" as const)
  };

  db.users.push(newUser);
  saveDB(db);

  // Return user without password
  const { password: _, ...userWithoutPassword } = newUser;
  res.status(201).json(userWithoutPassword);
});

app.post("/api/auth/login", validateLogin, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Veuillez saisir votre email et mot de passe." });
  }

  const normalizedEmail = email.toLowerCase();

  if (isSupabaseEnabled && supabase) {
    try {
      // 1. Authenticate using Supabase Auth (Native cryptographic match)
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: password,
      });

      if (authError) {
        // Essayer de migrer à la volée un utilisateur inséré par script SQL vers Supabase Auth
        try {
          const { data: dbUser, error: dbUserError } = await supabase
            .from("users")
            .select("*")
            .eq("email", normalizedEmail)
            .eq("password", password)
            .maybeSingle();

          if (dbUser && !dbUserError) {
            console.log(`[Supabase Auth Migration] Profil trouvé pour ${normalizedEmail}. Tentative de migration à la volée vers l'authentification native.`);
            
            // Créer le compte en mode Admin authentifié s'il n'existe pas encore sous l'Auth
            const { data: adminData, error: createAuthError } = await supabase.auth.admin.createUser({
              email: normalizedEmail,
              password: password,
              email_confirm: true,
              user_metadata: { name: dbUser.name, role: dbUser.role }
            });

            if (createAuthError) {
              console.error("[Supabase Auth Migration Error] Impossible de créer le compte dans Auth :", createAuthError.message);
            } else if (adminData?.user) {
              const newUuid = adminData.user.id;
              console.log(`[Supabase Auth Migration] Compte auth créé avec UUID : ${newUuid}. Remplacement dans la table public.`);
              
              // Supprimer l'ancienne ligne avec l'ID statique (pour éviter les conflits d'émail)
              await supabase.from("users").delete().eq("id", dbUser.id);
              
              // Insérer la nouvelle ligne reliée à l'UUID sécurisé
              const { data: newProfile, error: profileInsertError } = await supabase
                .from("users")
                .insert({
                  id: newUuid,
                  email: normalizedEmail,
                  password: "[SECURE_SUPABASE_AUTH]",
                  name: dbUser.name,
                  role: dbUser.role
                })
                .select()
                .single();

              if (profileInsertError) {
                console.error("[Supabase Auth Migration Error] Impossible de mettre à jour le profil public :", profileInsertError.message);
              } else {
                // Tenter une reconnexion avec les identifiants migrés
                const { data: authDataRetry, error: authErrorRetry } = await supabase.auth.signInWithPassword({
                  email: normalizedEmail,
                  password: password,
                });

                if (!authErrorRetry && authDataRetry?.user && newProfile) {
                  console.log(`[Supabase Auth Migration] Migration réussie avec succès et connexion établie pour ${normalizedEmail} !`);
                  return res.json({
                    id: newProfile.id,
                    email: newProfile.email,
                    name: newProfile.name,
                    role: newProfile.role,
                    token: authDataRetry?.session?.access_token
                  });
                }
              }
            }
          }
        } catch (migrationFail) {
          console.error("[Supabase Auth Migration Crash]", migrationFail);
        }

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
          token: authData?.session?.access_token
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
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);

  if (!user) {
    return res.status(401).json({ error: "Identifiants de connexion invalides." });
  }

  const { password: _, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

// Fetch User Purchased Tickets Endpoint
app.get("/api/my-tickets", async (req, res) => {
  const { buyerId } = req.query;

  if (!buyerId) {
    return res.status(400).json({ error: "buyerId requis." });
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
  const filtered = db.tickets.filter(t => t.buyerId === buyerId).map(t => ({
    ...t,
    paymentStatus: t.transactionRef?.startsWith("PENDING-") ? "pending" : "paid"
  }));
  res.json(filtered);
});

// Checkout Purchase Ticket Endpoint
app.post("/api/checkout", validateCheckout, async (req, res) => {
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

      const basePrice = Number(event.price);
      const unitPrice = tier === "vip" ? basePrice + 10000 : basePrice;
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

      return res.status(201).json({
        success: true,
        message: "Achat de billet effectué avec succès !",
        ticket: mappedTicket
      });
    } catch (err: any) {
      console.error("[Supabase Error] Checkout, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const event = db.events.find(e => e.id === eventId);

  if (!event) {
    return res.status(404).json({ error: "Événement introuvable." });
  }

  if (event.ticketsSold + qty > event.totalTickets) {
    return res.status(400).json({ error: "Désolé, il n'y a plus assez de places disponibles." });
  }

  const basePrice = event.price;
  const unitPrice = tier === "vip" ? basePrice + 10000 : basePrice; // +10,000 XOF flat for VIP Pass
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

  res.status(201).json({
    success: true,
    message: "Achat de billet effectué avec succès !",
    ticket: newTicket
  });
});

// Callback / Webhook endpoint pour recevoir les notifications de Paiement Pro (CI)
app.all("/api/payment/callback", async (req, res) => {
  console.log("[PaiementPro Webhook] Notification de paiement reçue :", {
    method: req.method,
    query: req.query,
    body: req.body
  });

  // Extraction des données classiques envoyées par Paiement Pro
  const referenceNumber = req.body.referenceNumber || req.query.referenceNumber || req.body.ref_command || req.query.ref_command;
  const status = req.body.status || req.query.status;

  if (!referenceNumber) {
    return res.status(400).json({ status: "error", message: "referenceNumber manquant" });
  }

  console.log(`[PaiementPro] Traitement du paiement pour la référence : ${referenceNumber}, statut reçu : ${status}`);

  if (isSupabaseEnabled && supabase) {
    try {
      // Rechercher le ticket correspondant à la référence
      const { data: ticket, error: fetchErr } = await supabase
        .from("tickets")
        .select("*")
        .eq("id", referenceNumber)
        .maybeSingle();

      if (fetchErr || !ticket) {
        console.warn(`[PaiementPro Callback] Ticket introuvable dans Supabase pour l'ID : ${referenceNumber}`);
      } else {
        console.log(`[PaiementPro Callback] Ticket correspondant trouvé dans Supabase : ${ticket.event_title}`);
        if(status === "SUCCESS" || status === "success" || req.body.status === true) {
          await supabase.from("tickets")
            .update({ transaction_ref: ticket.transaction_ref.replace("PENDING-", "PAID-") })
            .eq("id", referenceNumber);
        }
      }
    } catch (err: any) {
      console.error("[PaiementPro Callback Supabase Error]", err.message);
    }
  } else {
    const db = getDB();
    const ticket = db.tickets.find(t => t.id === referenceNumber);
    if (!ticket) {
      console.warn(`[PaiementPro Callback] Ticket local introuvable pour l'id : ${referenceNumber}`);
    } else {
      console.log(`[PaiementPro Callback] Ticket local de ${ticket.buyerName} mis à jour suite au callback.`);
      if(status === "SUCCESS" || status === "success" || req.body.status === true) {
        ticket.transactionRef = ticket.transactionRef.replace("PENDING-", "PAID-");
        saveDB(db);
      }
    }
  }

  // Renvoie un succès HTTP 200 à Paiement Pro pour confirmer la bonne réception
  res.status(200).json({ status: "success", message: "Notification traitée" });
});

// Ticket Verification Endpoint (QR Scanning Verification)
app.post("/api/verify-ticket", validateVerifyTicket, async (req, res) => {
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
  const ticket = db.tickets.find(t => t.id === ticketId);

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
app.get("/api/organizer/stats", async (req, res) => {
  const { organizerId } = req.query;

  if (!organizerId) {
    return res.status(400).json({ error: "organizerId requis." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      // 1. Get organizer events
      const { data: organizerEvents, error: eventsError } = await supabase
        .from("events")
        .select("*")
        .eq("organizer_id", organizerId);

      if (eventsError) throw eventsError;

      const eventIds = (organizerEvents || []).map(e => e.id);

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

      const totalGrossRevenue = matchedTickets.reduce((sum, t) => sum + Number(t.price_paid || 0), 0);
      const commissionRate = 0.10;
      const totalCommission = Math.floor(totalGrossRevenue * commissionRate);
      const totalRevenue = totalGrossRevenue - totalCommission;
      
      const ticketsSold = matchedTickets.reduce((sum, t) => sum + Number(t.quantity || 1), 0);
      const activeEvents = (organizerEvents || []).length;

      const recentSales = matchedTickets.slice(0, 10).map(t => ({
        eventTitle: t.event_title,
        buyerName: t.buyer_name,
        amount: Number(t.price_paid),
        date: t.purchase_date,
        tier: t.tier
      }));

      return res.json({
        totalRevenue,
        totalGrossRevenue,
        totalCommission,
        commissionRate,
        ticketsSold,
        activeEvents,
        recentSales
      });
    } catch (err: any) {
      console.error("[Supabase Error] Organizer statistics, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  
  // Custom filter if and only if organizer created it. (For fallback simulation let's grant view of all tickets of their events!)
  const organizerEvents = db.events.filter(e => e.organizerId === organizerId);
  const eventIds = organizerEvents.map(e => e.id);

  const matchedTickets = db.tickets.filter(t => eventIds.includes(t.eventId));

  const totalGrossRevenue = matchedTickets.reduce((sum, t) => sum + t.pricePaid, 0);
  const commissionRate = 0.10; // 10% ClicBillet Plateforme Commission
  const totalCommission = Math.floor(totalGrossRevenue * commissionRate);
  const totalRevenue = totalGrossRevenue - totalCommission; // Le solde chez l'organisateur (après déduction)
  
  const ticketsSold = matchedTickets.reduce((sum, t) => sum + t.quantity, 0);
  const activeEvents = organizerEvents.length;

  const recentSales = matchedTickets.slice(0, 10).map(t => ({
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
    recentSales
  });
});

// Update/Modify Event Endpoint
app.put("/api/events/:id", validateEvent, async (req, res) => {
  const { id } = req.params;
  const { title, description, date, time, price, venue, category, banner, totalTickets, organizerId } = req.body;

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
app.get("/api/admin/stats", async (req, res) => {
  if (isSupabaseEnabled && supabase) {
    try {
      const { data: users, error: uErr } = await supabase.from("users").select("*");
      const { data: events, error: eErr } = await supabase.from("events").select("*");
      const { data: tickets, error: tErr } = await supabase.from("tickets").select("*");

      if (uErr) throw uErr;
      if (eErr) throw eErr;
      if (tErr) throw tErr;

      const matchedTickets = tickets || [];
      const totalRevenue = matchedTickets.reduce((sum, t) => sum + Number(t.price_paid || 0), 0);
      const commissionRate = 0.10;
      const totalPlatformCommission = Math.floor(totalRevenue * commissionRate);
      const totalOrganizerPayout = totalRevenue - totalPlatformCommission;

      const totalTicketsSold = matchedTickets.reduce((sum, t) => sum + Number(t.quantity || 1), 0);
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
        organizerName: e.organizer_name
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
  const totalRevenue = db.tickets.reduce((sum, t) => sum + t.pricePaid, 0); // Total Gross XOF
  const commissionRate = 0.10;
  const totalPlatformCommission = Math.floor(totalRevenue * commissionRate); // Total collected by platform
  const totalOrganizerPayout = totalRevenue - totalPlatformCommission;
  
  const totalTicketsSold = db.tickets.reduce((sum, t) => sum + t.quantity, 0);
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

app.post("/api/admin/validate-payment", async (req, res) => {
  const { referenceNumber } = req.body;
  if (!referenceNumber) {
    return res.status(400).json({ error: "Référence ou ID du billet manquant." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: ticket, error: fetchErr } = await supabase.from("tickets")
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

app.delete("/api/admin/events/:id", async (req, res) => {
  const { id } = req.params;

  if (isSupabaseEnabled && supabase) {
    try {
      const { error } = await supabase
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

app.delete("/api/admin/users/:id", async (req, res) => {
  const { id } = req.params;
  if (id === "usr-admin") {
    return res.status(400).json({ error: "Le compte administrateur principal ne peut pas être révoqué ou supprimé." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { error } = await supabase
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

// Configure Vite middleware and static serving as requested
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`ClicBillet server running on http://0.0.0.0:${PORT}`);
    });
  } else {
    console.log("[Vercel] En cours d'exécution dans un environnement Serverless - app.listen ignoré.");
  }
}

startServer();

export default app;
