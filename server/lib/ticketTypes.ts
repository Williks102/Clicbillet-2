// Grille tarifaire d'un événement : la liste des types de billets que l'organisateur définit
// librement (colonne JSONB `ticket_types`). Ce module en est la source de vérité côté
// serveur — validation à l'écriture, protection des tarifs déjà vendus, fenêtres de vente à
// l'achat.
//
// Ces règles n'existaient nulle part auparavant : POST/PUT /api/events recopiaient
// `req.body.ticketTypes` tel quel en base. Un appel direct à l'API pouvait donc y déposer
// n'importe quel JSON (des milliers de paliers, un prix négatif, deux fois le même nom), et
// rien n'empêchait de renommer un tarif déjà vendu — ce qui orpheline les billets émis,
// puisque `tickets.tier` stocke le NOM du tarif en minuscules, pas un identifiant.

export interface TypeDeBillet {
  name: string;
  price: number;
  total: number;
  // Fenêtre de vente propre au tarif (early bird, pass tardif…), au format "YYYY-MM-DDTHH:MM"
  // interprété dans le fuseau du serveur — même convention que `date`/`time` de l'événement
  // (cf. getEventStart dans utils.ts). null = pas de borne de ce côté.
  salesStart: string | null;
  salesEnd: string | null;
}

export const MAX_TYPES_DE_BILLETS = 20;
// Aligné sur validateCheckout, qui refuse déjà un `item.tier` de plus de 50 caractères : un
// tarif plus long que cette borne serait invendable.
export const MAX_LONGUEUR_NOM_TARIF = 50;
const PRIX_MAX = 50000000;
const PLACES_MAX = 1000000;

const FORMAT_DATE_HEURE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// La clé d'un tarif est son nom en minuscules : c'est ce que stocke `tickets.tier` et ce que
// comparent la fonction reserve_tickets et le tunnel d'achat.
export function cleDuTarif(nom: unknown): string {
  return String(nom ?? "").trim().toLowerCase();
}

function formaterDateHeure(valeur: string): string {
  // Reformatage purement textuel : passer par Date() ne servirait qu'à réintroduire un
  // décalage de fuseau dans un message destiné à l'acheteur.
  const [jour, heure] = valeur.split("T");
  const [a, m, j] = jour.split("-");
  return `${j}/${m}/${a} à ${heure}`;
}

/**
 * Valide et normalise la grille tarifaire reçue du client. Retourne soit un message d'erreur
 * prêt à être renvoyé en 400, soit la liste nettoyée — champs inconnus retirés, nombres
 * convertis — telle qu'elle doit être écrite en base.
 */
export function normaliserTypesDeBillets(
  brut: unknown,
  contexte: { totalTickets: number }
): { erreur: string } | { types: TypeDeBillet[] } {
  if (brut === undefined || brut === null) {
    return { types: [] };
  }
  if (!Array.isArray(brut)) {
    return { erreur: "La liste des types de billets est invalide." };
  }
  if (brut.length > MAX_TYPES_DE_BILLETS) {
    return { erreur: `Un événement ne peut pas compter plus de ${MAX_TYPES_DE_BILLETS} types de billets.` };
  }

  const types: TypeDeBillet[] = [];
  const clesVues = new Set<string>();
  let sommeDesQuotas = 0;

  for (const entree of brut) {
    if (!entree || typeof entree !== "object" || Array.isArray(entree)) {
      return { erreur: "Chaque type de billet doit être un objet { name, price, total }." };
    }
    const brutTarif = entree as Record<string, unknown>;

    const nom = typeof brutTarif.name === "string" ? brutTarif.name.trim() : "";
    if (!nom) {
      return { erreur: "Chaque type de billet doit porter un nom." };
    }
    if (nom.length > MAX_LONGUEUR_NOM_TARIF) {
      return { erreur: `Le nom d'un type de billet ne peut pas dépasser ${MAX_LONGUEUR_NOM_TARIF} caractères.` };
    }

    // Deux tarifs de même nom se confondraient dès l'achat : la commande, le compteur
    // `tier_sold` et les billets émis ne retiennent que la clé en minuscules.
    const cle = cleDuTarif(nom);
    if (clesVues.has(cle)) {
      return { erreur: `Le type de billet « ${nom} » est défini deux fois. Chaque nom doit être unique.` };
    }
    clesVues.add(cle);

    const prix = Number(brutTarif.price);
    if (!Number.isFinite(prix) || prix < 0) {
      return { erreur: `Le prix du type de billet « ${nom} » doit être un nombre positif ou nul.` };
    }
    if (prix > PRIX_MAX) {
      return { erreur: `Le prix du type de billet « ${nom} » dépasse la limite autorisée.` };
    }

    const quotaBrut = brutTarif.total === undefined || brutTarif.total === null || brutTarif.total === "" ? 0 : Number(brutTarif.total);
    if (!Number.isFinite(quotaBrut) || quotaBrut < 0 || !Number.isInteger(quotaBrut)) {
      return { erreur: `Le nombre de places du type de billet « ${nom} » doit être un entier positif ou nul.` };
    }
    if (quotaBrut > PLACES_MAX) {
      return { erreur: `Le nombre de places du type de billet « ${nom} » est trop élevé.` };
    }
    sommeDesQuotas += quotaBrut;

    const fenetre = lireFenetre(brutTarif, nom);
    if ("erreur" in fenetre) return fenetre;

    types.push({ name: nom, price: prix, total: quotaBrut, salesStart: fenetre.salesStart, salesEnd: fenetre.salesEnd });
  }

  // Un quota par tarif ne vaut que dans la limite de la capacité de la salle. Au-delà, la
  // grille annonce des places que reserve_tickets refusera de toute façon (il vérifie
  // d'abord la capacité globale) : autant le dire à l'organisateur au moment de la saisie.
  if (sommeDesQuotas > contexte.totalTickets) {
    return {
      erreur: `La somme des places par type de billet (${sommeDesQuotas}) dépasse le nombre total de places de l'événement (${contexte.totalTickets}).`
    };
  }

  return { types };
}

function lireFenetre(
  brutTarif: Record<string, unknown>,
  nom: string
): { erreur: string } | { salesStart: string | null; salesEnd: string | null } {
  const lire = (valeur: unknown): string | null => {
    if (valeur === undefined || valeur === null || valeur === "") return null;
    return String(valeur).trim().slice(0, 16);
  };

  const salesStart = lire(brutTarif.salesStart);
  const salesEnd = lire(brutTarif.salesEnd);

  for (const [valeur, libelle] of [[salesStart, "d'ouverture"], [salesEnd, "de clôture"]] as const) {
    if (valeur === null) continue;
    if (!FORMAT_DATE_HEURE.test(valeur) || isNaN(new Date(valeur).getTime())) {
      return { erreur: `La date ${libelle} des ventes du type de billet « ${nom} » est invalide.` };
    }
  }

  if (salesStart && salesEnd && new Date(salesEnd).getTime() <= new Date(salesStart).getTime()) {
    return { erreur: `La clôture des ventes du type de billet « ${nom} » doit être postérieure à son ouverture.` };
  }

  return { salesStart, salesEnd };
}

export type EtatDeVente = "a-venir" | "ouverte" | "close";

export function etatDeVente(
  tarif: { salesStart?: string | null; salesEnd?: string | null },
  maintenant: Date = new Date()
): EtatDeVente {
  const debut = tarif.salesStart ? new Date(tarif.salesStart) : null;
  const fin = tarif.salesEnd ? new Date(tarif.salesEnd) : null;
  if (debut && !isNaN(debut.getTime()) && maintenant < debut) return "a-venir";
  if (fin && !isNaN(fin.getTime()) && maintenant >= fin) return "close";
  return "ouverte";
}

/**
 * Refuse une commande dont un des tarifs est hors de sa fenêtre de vente. Retourne le message
 * à afficher à l'acheteur, ou null si tout est en vente.
 *
 * Appelé AVANT la réservation du stock : refuser après obligerait à rendre les places, et un
 * tarif fermé n'a de toute façon aucune raison d'entamer le compteur.
 */
export function refusFenetreDeVente(
  typesDeBillets: unknown,
  items: Array<{ tier: string; quantity: number }>,
  maintenant: Date = new Date()
): string | null {
  const parCle = new Map<string, any>();
  for (const t of Array.isArray(typesDeBillets) ? typesDeBillets : []) {
    if (t && typeof t.name === "string") parCle.set(cleDuTarif(t.name), t);
  }

  for (const item of items) {
    const def = parCle.get(cleDuTarif(item.tier));
    // Tarif absent de la grille : l'achat retombe sur le prix de base de l'événement
    // (cf. /api/checkout), il n'y a donc pas de fenêtre à faire respecter.
    if (!def) continue;

    const etat = etatDeVente(def, maintenant);
    if (etat === "a-venir") {
      return `La vente des billets « ${def.name} » ouvre le ${formaterDateHeure(def.salesStart)}.`;
    }
    if (etat === "close") {
      return `La vente des billets « ${def.name} » est terminée depuis le ${formaterDateHeure(def.salesEnd)}.`;
    }
  }

  return null;
}

/**
 * Garde-fou de modification d'événement : un tarif déjà vendu ne peut être ni supprimé, ni
 * renommé, ni ramené sous le nombre de billets émis.
 *
 * `tickets.tier` référence le tarif par son nom : renommer « VIP » en « Carré Or » laissait
 * les billets déjà vendus pointer vers un tarif inexistant — invisibles dans les compteurs
 * par catégorie, et leurs places aussitôt remises en vente sous le nouveau nom.
 */
export function refusModificationTarifs(
  anciensTypes: unknown,
  nouveauxTypes: TypeDeBillet[],
  vendusParTarif: Record<string, number>,
  capacite: { totalTickets: number; ticketsSold: number }
): string | null {
  if (capacite.totalTickets < capacite.ticketsSold) {
    return `Le nombre total de places (${capacite.totalTickets}) ne peut pas être inférieur aux ${capacite.ticketsSold} billet(s) déjà vendu(s).`;
  }

  const nomsAnciens = new Map<string, string>();
  for (const t of Array.isArray(anciensTypes) ? anciensTypes : []) {
    if (t && typeof t.name === "string") nomsAnciens.set(cleDuTarif(t.name), t.name);
  }
  const nouveauxParCle = new Map<string, TypeDeBillet>();
  for (const t of nouveauxTypes) nouveauxParCle.set(cleDuTarif(t.name), t);

  for (const [cle, vendus] of Object.entries(vendusParTarif)) {
    if (!Number.isFinite(vendus) || vendus <= 0) continue;
    const libelle = nomsAnciens.get(cle) || cle;

    const conserve = nouveauxParCle.get(cle);
    if (!conserve) {
      return `Le type de billet « ${libelle} » compte déjà ${vendus} billet(s) vendu(s) : il ne peut être ni supprimé ni renommé. Créez plutôt un nouveau type à côté.`;
    }

    // Un quota à 0 signifie « pas de plafond propre » (le tarif ne borne que la capacité
    // globale) : ce n'est pas une réduction sous les ventes.
    if (conserve.total > 0 && conserve.total < vendus) {
      return `Le quota du type de billet « ${libelle} » (${conserve.total}) ne peut pas être inférieur aux ${vendus} billet(s) déjà vendu(s).`;
    }
  }

  return null;
}

// Compte les ventes par tarif à partir de lignes de billets. Les références FAILED-/EXPIRED-
// correspondent à des paniers abandonnés dont les places ont déjà été rendues au stock ;
// les PENDING- sont en revanche comptés, car leurs places sont retenues.
export function compterVendusParTarif(
  billets: Array<{ tier?: string; transaction_ref?: string; transactionRef?: string }>
): Record<string, number> {
  const compte: Record<string, number> = {};
  for (const b of billets) {
    const ref = String(b.transaction_ref ?? b.transactionRef ?? "");
    if (ref.startsWith("FAILED-") || ref.startsWith("EXPIRED-")) continue;
    const cle = cleDuTarif(b.tier || "standard");
    compte[cle] = (compte[cle] || 0) + 1;
  }
  return compte;
}
