// Habillage du pass (billet) d'un événement : couleurs, logo et image de fond choisis par
// l'organisateur, stockés dans la colonne JSONB `pass_design` de `events`.
//
// Ces valeurs finissent interpolées dans du HTML et dans des attributs `style` — le pass
// affiché dans l'espace acheteur, mais surtout le document d'impression, construit par
// concaténation de chaînes (cf. src/lib/printDocument.ts). Échapper le HTML n'y suffirait
// pas : à l'intérieur d'un `style="…"`, une couleur valant `red;background:url(//x)` reste
// du CSS parfaitement valide, injecté sans balise ni guillemet. D'où une validation par
// liste blanche stricte — une couleur est un #RRGGBB, rien d'autre.

export interface PassDesign {
  // Accents : liseré du pass, prix, pastille du tarif.
  primaryColor: string;
  // Fond du pass et couleur du texte principal.
  backgroundColor: string;
  textColor: string;
  // Logo de l'organisateur, affiché en tête du pass. null = logo ClicBillet par défaut.
  logoUrl: string | null;
  // Image de fond du pass, atténuée par backgroundOpacity pour que le QR code et les
  // mentions restent lisibles — c'est ce voile qui garantit le contraste.
  backgroundImageUrl: string | null;
  backgroundOpacity: number;
}

export const PASS_DESIGN_PAR_DEFAUT: PassDesign = {
  primaryColor: "#ea580c",
  backgroundColor: "#ffffff",
  textColor: "#111827",
  logoUrl: null,
  backgroundImageUrl: null,
  backgroundOpacity: 0.12
};

const LIBELLES: Record<string, string> = {
  primaryColor: "d'accentuation",
  backgroundColor: "de fond",
  textColor: "du texte",
  logoUrl: "de logo",
  backgroundImageUrl: "de fond"
};

const FORMAT_COULEUR = /^#[0-9a-fA-F]{6}$/;
// Même règle que la bannière d'événement (cf. validateEvent) : une URL distante ou une image
// téléversée, que le navigateur compresse en data: URI avant l'envoi.
const MAX_LONGUEUR_IMAGE = 2_000_000;

function lireCouleur(valeur: unknown, champ: string): { erreur: string } | { couleur: string | undefined } {
  if (valeur === undefined || valeur === null || valeur === "") return { couleur: undefined };
  const brut = String(valeur).trim();
  if (!FORMAT_COULEUR.test(brut)) {
    return { erreur: `La couleur ${champ} du pass doit être un code hexadécimal de la forme #RRGGBB.` };
  }
  return { couleur: brut.toLowerCase() };
}

// Une image importée par l'organisateur est une data: URI base64 (le navigateur la compresse
// avant l'envoi, cf. src/lib/imageCompress.ts) ; sinon c'est une URL http(s). Les deux formes
// sont décrites en liste blanche : c'est ce qui garantit qu'aucun guillemet, parenthèse ni
// espace ne peut s'y glisser pour s'échapper du `url(…)` du CSS généré.
const FORMAT_DATA_URI = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;
const FORMAT_URL_IMAGE = /^https?:\/\/[^\s"'()\\<>]+$/;

function lireImage(valeur: unknown, champ: string): { erreur: string } | { image: string | null | undefined } {
  if (valeur === undefined) return { image: undefined };
  // null explicite = l'organisateur retire l'image.
  if (valeur === null || valeur === "") return { image: null };

  const brut = String(valeur).trim();
  if (brut.length > MAX_LONGUEUR_IMAGE) {
    return { erreur: `L'image ${champ} du pass est trop lourde. Choisissez une image plus légère.` };
  }
  if (!FORMAT_DATA_URI.test(brut) && !FORMAT_URL_IMAGE.test(brut)) {
    return { erreur: `L'image ${champ} du pass est invalide : importez un fichier image ou donnez une adresse http(s) directe.` };
  }
  return { image: brut };
}

/**
 * Valide l'habillage reçu du client et le complète avec les valeurs par défaut. Retourne un
 * message d'erreur prêt pour une 400, ou l'objet complet à écrire en base.
 *
 * `existant` permet une mise à jour partielle : un champ absent du corps de la requête garde
 * sa valeur actuelle plutôt que de retomber au thème par défaut.
 */
export function normaliserPassDesign(
  brut: unknown,
  existant?: unknown
): { erreur: string } | { design: PassDesign } {
  const base = fusionnerPassDesign(existant);

  if (brut === undefined || brut === null) {
    return { design: base };
  }
  if (typeof brut !== "object" || Array.isArray(brut)) {
    return { erreur: "L'habillage du pass est invalide." };
  }

  const entree = brut as Record<string, unknown>;
  const design: PassDesign = { ...base };

  for (const champ of ["primaryColor", "backgroundColor", "textColor"] as const) {
    const lu = lireCouleur(entree[champ], LIBELLES[champ]);
    if ("erreur" in lu) return lu;
    if (lu.couleur !== undefined) design[champ] = lu.couleur;
  }

  for (const champ of ["logoUrl", "backgroundImageUrl"] as const) {
    const lu = lireImage(entree[champ], LIBELLES[champ]);
    if ("erreur" in lu) return lu;
    if (lu.image !== undefined) design[champ] = lu.image;
  }

  if (entree.backgroundOpacity !== undefined && entree.backgroundOpacity !== null && entree.backgroundOpacity !== "") {
    const opacite = Number(entree.backgroundOpacity);
    if (!Number.isFinite(opacite) || opacite < 0 || opacite > 1) {
      return { erreur: "L'intensité de l'image de fond du pass doit être comprise entre 0 et 1." };
    }
    design.backgroundOpacity = Math.round(opacite * 100) / 100;
  }

  return { design };
}

/**
 * Complète un habillage lu en base avec les valeurs par défaut, en écartant toute valeur qui
 * ne passe plus la validation. Un enregistrement antérieur à cette validation — ou modifié
 * hors application — ne peut donc pas faire passer de CSS arbitraire dans le pass rendu.
 */
export function fusionnerPassDesign(brut: unknown): PassDesign {
  const design: PassDesign = { ...PASS_DESIGN_PAR_DEFAUT };
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return design;

  const entree = brut as Record<string, unknown>;
  for (const champ of ["primaryColor", "backgroundColor", "textColor"] as const) {
    const lu = lireCouleur(entree[champ], LIBELLES[champ]);
    if (!("erreur" in lu) && lu.couleur !== undefined) design[champ] = lu.couleur;
  }
  for (const champ of ["logoUrl", "backgroundImageUrl"] as const) {
    const lu = lireImage(entree[champ], LIBELLES[champ]);
    if (!("erreur" in lu) && lu.image !== undefined) design[champ] = lu.image;
  }
  const opacite = Number(entree.backgroundOpacity);
  if (Number.isFinite(opacite) && opacite >= 0 && opacite <= 1) {
    design.backgroundOpacity = Math.round(opacite * 100) / 100;
  }
  return design;
}
