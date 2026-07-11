import express from "express";

export const validateRegister = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
export const validateResetPassword = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Lien de réinitialisation ou nouveau mot de passe manquant." });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères pour des raisons de sécurité." });
  }

  next();
};

// Middleware de validation pour la création / modification d'événements
export const validateEvent = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const { title, date, time, price, venue, category, banner, totalTickets, organizerId, ticketTypes } = req.body;

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

  if (banner && !banner.startsWith("http://") && !banner.startsWith("https://") && !banner.startsWith("data:image/")) {
    return res.status(400).json({ error: "L'URL de l'image de couverture est invalide (doit commencer par http://, https:// ou être une image uploadée)." });
  }

  // Paliers de billets personnalisés (optionnels). S'ils sont fournis, on borne leur forme :
  // le checkout facture au prix du palier correspondant (match par nom, insensible à la casse,
  // cf. POST /api/checkout), donc un nom vide, un prix négatif ou des noms en double doivent
  // être rejetés ici plutôt que de créer un événement dont les prix seraient incohérents.
  if (ticketTypes !== undefined && ticketTypes !== null) {
    if (!Array.isArray(ticketTypes)) {
      return res.status(400).json({ error: "Le format des paliers de billets est invalide." });
    }
    if (ticketTypes.length > 20) {
      return res.status(400).json({ error: "Un événement ne peut pas définir plus de 20 paliers de billets." });
    }
    const seenNames = new Set<string>();
    for (const t of ticketTypes) {
      const name = typeof t?.name === "string" ? t.name.trim() : "";
      if (!name || name.length > 50) {
        return res.status(400).json({ error: "Chaque palier doit avoir un nom (1 à 50 caractères)." });
      }
      const key = name.toLowerCase();
      if (seenNames.has(key)) {
        return res.status(400).json({ error: `Le palier "${name}" est défini en double.` });
      }
      seenNames.add(key);

      if (t?.price === undefined || t?.price === null || isNaN(Number(t.price)) || Number(t.price) < 0 || Number(t.price) > 50000000) {
        return res.status(400).json({ error: `Le prix du palier "${name}" doit être un nombre entre 0 et 50 000 000.` });
      }
      if (t?.total !== undefined && t?.total !== null && t?.total !== "" && (isNaN(Number(t.total)) || Number(t.total) < 0 || Number(t.total) > 1000000)) {
        return res.status(400).json({ error: `Le quota du palier "${name}" doit être un nombre entre 0 et 1 000 000.` });
      }
    }
  }

  next();
};

// Middleware de validation de commande de billet (Checkout)
// Une commande (panier) contient un ou plusieurs items, un par type de billet distinct
// (ex: { tier: "standard", quantity: 2 } + { tier: "gp", quantity: 1 }). Le nom du palier
// est libre (défini par l'organisateur via event.ticketTypes, cf. POST /api/events) — cette
// validation ne fait que borner la forme de la chaîne ; la correspondance avec un palier
// réellement défini sur l'événement est vérifiée plus loin dans POST /api/checkout, où
// l'événement est chargé.
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
    const normalizedTier = typeof item?.tier === "string" ? item.tier.trim().toLowerCase() : "";
    if (!normalizedTier || normalizedTier.length > 50) {
      return res.status(400).json({ error: "Chaque billet doit indiquer un palier valide." });
    }

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

