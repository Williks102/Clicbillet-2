import crypto from "crypto";
import express from "express";
import { resoudreCategorie } from "./categories.js";
import { normaliserTypesDeBillets } from "./ticketTypes.js";

const MIN_PASSWORD_LENGTH = 10;

// Vérifie un mot de passe contre l'API "Pwned Passwords" (k-anonymité) : seuls les 5
// premiers caractères du SHA-1 du mot de passe sont envoyés à l'API, jamais le mot de passe
// ni son hash complet — impossible pour le service tiers de le reconstituer. Best-effort :
// si l'API est indisponible/lente, on ne bloque jamais l'inscription pour autant (délai de
// 3s max), la seule vraie barrière contre les mots de passe faibles reste la longueur minimale.
async function isPasswordBreached(password: string): Promise<boolean> {
  const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error(`Réponse HIBP inattendue : ${response.status}`);

  const body = await response.text();
  return body.split("\n").some((line) => line.split(":")[0].trim() === suffix);
}

export const validateRegister = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { email, password, name, role } = req.body;

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: "Tous les champs d'inscription sont obligatoires (email, password, name, role)." });
  }

  // Vérification rigoureuse du format e-mail
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Le format de l'e-mail est invalide." });
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères pour des raisons de sécurité.` });
  }

  try {
    if (await isPasswordBreached(password)) {
      return res.status(400).json({ error: "Ce mot de passe est apparu dans une fuite de données connue. Choisissez-en un autre." });
    }
  } catch (err: any) {
    console.warn("[Password Check] Vérification anti-fuite indisponible, inscription non bloquée :", err.message);
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
export const validateLogin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

// Middleware de validation pour la demande de réinitialisation de mot de passe
export const validateForgotPassword = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Veuillez saisir votre adresse e-mail." });
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Le format de l'e-mail est invalide." });
  }

  next();
};

// Middleware de validation pour la finalisation de la réinitialisation de mot de passe
export const validateResetPassword = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Lien de réinitialisation ou nouveau mot de passe manquant." });
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères pour des raisons de sécurité.` });
  }

  try {
    if (await isPasswordBreached(newPassword)) {
      return res.status(400).json({ error: "Ce mot de passe est apparu dans une fuite de données connue. Choisissez-en un autre." });
    }
  } catch (err: any) {
    console.warn("[Password Check] Vérification anti-fuite indisponible, réinitialisation non bloquée :", err.message);
  }

  next();
};

// Middleware de validation pour la création / modification d'événements
export const validateEvent = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { title, description, date, time, price, venue, category, banner, totalTickets, organizerId } = req.body;
  let { endDate, endTime } = req.body;

  if (!title || !date || !time || !venue || !category || !organizerId) {
    return res.status(400).json({ error: "Veuillez remplir tous les champs obligatoires correctement." });
  }

  // Bornes de longueur : évite qu'un champ libre (des Mo de texte, le body JSON global
  // autorisant jusqu'à 10 Mo) ne gonfle indéfiniment le stockage à chaque création d'événement.
  if (String(title).length > 200) {
    return res.status(400).json({ error: "Le titre ne peut pas dépasser 200 caractères." });
  }
  if (description && String(description).length > 5000) {
    return res.status(400).json({ error: "La description ne peut pas dépasser 5000 caractères." });
  }
  if (String(venue).length > 200) {
    return res.status(400).json({ error: "Le lieu ne peut pas dépasser 200 caractères." });
  }
  if (String(category).length > 100) {
    return res.status(400).json({ error: "La catégorie ne peut pas dépasser 100 caractères." });
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

  // Fin d'événement (facultative). Elle borne la fenêtre de scan : sans elle, on retombe
  // sur une durée par défaut (EVENT_DEFAULT_DURATION_HOURS). Une heure de fin seule signifie
  // « le même jour » — c'est le cas courant, on complète la date plutôt que de refuser.
  endDate = endDate || "";
  endTime = endTime || "";

  if (endTime && !endDate) {
    endDate = date;
  }
  if (endDate && !endTime) {
    return res.status(400).json({ error: "Veuillez préciser l'heure de fin de l'événement." });
  }

  if (endDate) {
    if (!dateRegex.test(endDate)) {
      return res.status(400).json({ error: "Le format de la date de fin doit être YYYY-MM-DD." });
    }
    if (!timeRegex.test(endTime)) {
      return res.status(400).json({ error: "Le format de l'heure de fin doit être HH:MM." });
    }

    const start = new Date(`${date}T${time}`);
    const end = new Date(`${endDate}T${endTime}`);
    if (isNaN(end.getTime())) {
      return res.status(400).json({ error: "La date de fin de l'événement est invalide." });
    }
    if (end.getTime() <= start.getTime()) {
      return res.status(400).json({ error: "La fin de l'événement doit être postérieure à son début." });
    }
    // Garde-fou : au-delà d'un mois, c'est presque toujours une faute de saisie (année erronée),
    // et la fenêtre de scan resterait ouverte des semaines durant.
    if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: "La durée de l'événement ne peut pas dépasser 31 jours." });
    }
  }

  req.body.endDate = endDate || null;
  req.body.endTime = endTime || null;

  if (banner && !banner.startsWith("http://") && !banner.startsWith("https://") && !banner.startsWith("data:image/")) {
    return res.status(400).json({ error: "L'URL de l'image de couverture est invalide (doit commencer par http://, https:// ou être une image uploadée)." });
  }

  // La catégorie doit exister au référentiel (cf. server/lib/categories.ts). Auparavant
  // n'importe quel texte de moins de 100 caractères passait : un "concert" en minuscules
  // créait un événement introuvable sous la puce "Concert", sans erreur ni avertissement.
  //
  // La saisie est acceptée sous forme de clé ("concert") comme de libellé ("Concert") : le
  // frontend envoie la clé, mais un appel d'API existant qui envoie encore le libellé
  // continue de fonctionner.
  const categorieResolue = await resoudreCategorie(String(category));
  if (!categorieResolue) {
    return res.status(400).json({ error: "Catégorie inconnue. Choisissez-en une dans la liste proposée." });
  }
  // L'aval ne manipule plus que des valeurs canoniques.
  req.body.category = categorieResolue.label;
  req.body.categorySlug = categorieResolue.slug;

  // Grille tarifaire : jusqu'ici recopiée telle quelle en base par POST/PUT /api/events, donc
  // libre de contenir n'importe quel JSON (noms vides ou en double, prix négatifs, quotas
  // fantaisistes, liste sans fin). Le formulaire organisateur filtrait bien les lignes vides,
  // mais un appel direct à l'API ne passe pas par lui.
  const tarifs = normaliserTypesDeBillets(req.body.ticketTypes, { totalTickets: Number(totalTickets) });
  if ("erreur" in tarifs) {
    return res.status(400).json({ error: tarifs.erreur });
  }
  // L'aval écrit la version nettoyée (champs inconnus retirés, nombres convertis).
  req.body.ticketTypes = tarifs.types;

  next();
};

// Middleware de validation de commande de billet (Checkout)
// Une commande (panier) contient un ou plusieurs items, un par type de billet distinct
// (ex: { tier: "standard", quantity: 2 } + { tier: "vip", quantity: 1 }). Un organisateur peut
// nommer ses types de billets librement (cf. OrganizerDashboard.tsx, champ texte libre) — ce
// middleware ne connaît pas les tarifs propres à CET événement (il tourne avant tout accès
// base de données), donc il ne valide que la forme du nom, pas son appartenance à l'événement.
// La correspondance avec les tarifs réellement définis se fait plus loin dans la route
// /api/checkout (server/routes/tickets.ts), qui cherche le nom exact parmi event.ticketTypes.
export const validateCheckout = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { eventId, buyerId, buyerName, buyerEmail, guestPhone, items, paymentDetails } = req.body;
  const isGuest = !buyerId && !!buyerEmail;

  // Logged-in users must have buyerId; guests must provide buyerEmail + guestPhone
  if (!eventId || (!buyerId && !buyerEmail) || !buyerName || !buyerEmail || !Array.isArray(items) || items.length === 0 || !paymentDetails) {
    return res.status(400).json({ error: "Champs d'achat de billets incomplets." });
  }
  if (isGuest && (!guestPhone || String(guestPhone).replace(/\s+/g, "").length < 8)) {
    return res.status(400).json({ error: "Un numéro de téléphone valide est requis pour l'achat sans compte." });
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(buyerEmail)) {
    return res.status(400).json({ error: "L'adresse e-mail de l'acheteur est invalide." });
  }

  const normalizedItems: Array<{ tier: string; quantity: number }> = [];
  let totalQuantity = 0;

  for (const item of items) {
    if (typeof item?.tier !== "string" || !item.tier.trim() || item.tier.length > 50) {
      return res.status(400).json({ error: "Chaque billet doit indiquer un type de tarif valide." });
    }
    const normalizedTier = item.tier.toLowerCase();

    const qtyVal = Number(item?.quantity);
    if (isNaN(qtyVal) || qtyVal < 1 || qtyVal > 20) {
      return res.status(400).json({ error: "La quantité par type de billet doit être comprise entre 1 et 20." });
    }

    totalQuantity += qtyVal;
    normalizedItems.push({ tier: normalizedTier, quantity: qtyVal });
  }

  if (totalQuantity > 20) {
    return res.status(400).json({ error: "Vous ne pouvez pas commander plus de 20 billets au total par commande." });
  }

  const tierNames = normalizedItems.map((i) => i.tier);
  if (new Set(tierNames).size !== tierNames.length) {
    return res.status(400).json({ error: "Chaque type de billet ne peut apparaître qu'une seule fois dans la commande." });
  }

  req.body.items = normalizedItems;

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
export const validateVerifyTicket = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { qrCodeData } = req.body;

  if (!qrCodeData) {
    return res.status(400).json({ error: "Code QR d'accès requis." });
  }

  if (!qrCodeData.startsWith("clicbillet-verify:")) {
    return res.status(400).json({ error: "Format de code d'accès ou signature invalide." });
  }

  next();
};

// Middleware de validation du transfert de billet (espace client)
export const validateTransferTicket = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { recipientEmail, recipientName } = req.body;

  if (!recipientEmail || typeof recipientEmail !== "string") {
    return res.status(400).json({ error: "L'adresse e-mail du destinataire est requise." });
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(recipientEmail)) {
    return res.status(400).json({ error: "Le format de l'e-mail du destinataire est invalide." });
  }

  if (recipientName !== undefined && (typeof recipientName !== "string" || recipientName.length > 100)) {
    return res.status(400).json({ error: "Le nom du destinataire est invalide." });
  }

  next();
};

// Middleware de validation de la demande de passage acheteur -> organisateur.
// Le nom de structure et le téléphone sont obligatoires : ce sont les deux éléments dont
// l'administrateur a besoin pour rappeler le demandeur avant d'approuver un compte qui
// encaissera de l'argent. La motivation reste facultative.
export const validateOrganizerRequest = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { organizationName, phone, motivation } = req.body;

  if (!organizationName || typeof organizationName !== "string" || !organizationName.trim() || organizationName.length > 120) {
    return res.status(400).json({ error: "Le nom de votre structure est requis (120 caractères maximum)." });
  }

  const normalizedPhone = String(phone || "").replace(/\s+/g, "");
  if (!normalizedPhone || normalizedPhone.length < 8 || normalizedPhone.length > 20 || !/^\+?\d+$/.test(normalizedPhone)) {
    return res.status(400).json({ error: "Un numéro de téléphone valide est requis." });
  }

  if (motivation !== undefined && (typeof motivation !== "string" || motivation.length > 1000)) {
    return res.status(400).json({ error: "La description de votre activité ne peut pas dépasser 1000 caractères." });
  }

  req.body.phone = normalizedPhone;
  next();
};

// Middleware de validation du formulaire de contact public (page /contact, non authentifié).
const CONTACT_SUBJECTS = new Set([
  "Question générale",
  "Problème technique",
  "Problème de paiement",
  "Demande de remboursement",
  "Devenir partenaire",
  "Autre"
]);

export const validateContactMessage = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { name, email, subject, message } = req.body;

  if (!name || typeof name !== "string" || !name.trim() || name.length > 100) {
    return res.status(400).json({ error: "Le nom est requis (100 caractères maximum)." });
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!email || typeof email !== "string" || !emailRegex.test(email)) {
    return res.status(400).json({ error: "L'adresse e-mail est invalide." });
  }

  if (!subject || !CONTACT_SUBJECTS.has(subject)) {
    return res.status(400).json({ error: "Veuillez choisir un sujet valide." });
  }

  if (!message || typeof message !== "string" || !message.trim() || message.length > 5000) {
    return res.status(400).json({ error: "Le message est requis (5000 caractères maximum)." });
  }

  next();
};

