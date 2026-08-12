import { PassDesign } from "../types";

// Habillage du pass côté navigateur : valeurs par défaut, garde-fou de lecture et fabrique des
// styles appliqués au billet (à l'écran comme à l'impression).
//
// Le garde-fou fait écho à celui du serveur (server/lib/passDesign.ts) et n'est pas
// redondant : le pass imprimable est produit par concaténation de chaînes HTML, où une couleur
// arbitraire suffirait à injecter du CSS sans jamais ouvrir de balise. Tout ce qui n'est pas
// un #RRGGBB retombe donc ici sur le thème par défaut.

export const PASS_DESIGN_PAR_DEFAUT: PassDesign = {
  primaryColor: "#ea580c",
  backgroundColor: "#ffffff",
  textColor: "#111827",
  logoUrl: null,
  backgroundImageUrl: null,
  backgroundOpacity: 0.12
};

const FORMAT_COULEUR = /^#[0-9a-fA-F]{6}$/;
const FORMAT_DATA_URI = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;
const FORMAT_URL_IMAGE = /^https?:\/\/[^\s"'()\\<>]+$/;

function couleurSure(valeur: unknown, repli: string): string {
  const brut = String(valeur ?? "").trim();
  return FORMAT_COULEUR.test(brut) ? brut : repli;
}

function imageSure(valeur: unknown): string | null {
  if (!valeur) return null;
  const brut = String(valeur).trim();
  return FORMAT_DATA_URI.test(brut) || FORMAT_URL_IMAGE.test(brut) ? brut : null;
}

export function resolvePassDesign(brut: PassDesign | null | undefined): PassDesign {
  if (!brut || typeof brut !== "object") return { ...PASS_DESIGN_PAR_DEFAUT };
  const opacite = Number(brut.backgroundOpacity);
  return {
    primaryColor: couleurSure(brut.primaryColor, PASS_DESIGN_PAR_DEFAUT.primaryColor),
    backgroundColor: couleurSure(brut.backgroundColor, PASS_DESIGN_PAR_DEFAUT.backgroundColor),
    textColor: couleurSure(brut.textColor, PASS_DESIGN_PAR_DEFAUT.textColor),
    logoUrl: imageSure(brut.logoUrl),
    backgroundImageUrl: imageSure(brut.backgroundImageUrl),
    backgroundOpacity: Number.isFinite(opacite) && opacite >= 0 && opacite <= 1
      ? opacite
      : PASS_DESIGN_PAR_DEFAUT.backgroundOpacity
  };
}

// Décline une couleur du thème en version translucide, pour le texte secondaire et les
// séparateurs : dériver de la couleur choisie garde le pass cohérent, là où un gris fixe
// devenait illisible sur un fond sombre.
export function hexToRgba(hex: string, alpha: number): string {
  const sur = couleurSure(hex, PASS_DESIGN_PAR_DEFAUT.textColor);
  const r = parseInt(sur.slice(1, 3), 16);
  const g = parseInt(sur.slice(3, 5), 16);
  const b = parseInt(sur.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Luminance perçue (Rec. 709), pour choisir une couleur de texte lisible SUR la couleur
// d'accentuation : une pastille orange demande du texte blanc, une pastille jaune du noir.
export function contrasteSur(hex: string): string {
  const sur = couleurSure(hex, PASS_DESIGN_PAR_DEFAUT.primaryColor);
  const r = parseInt(sur.slice(1, 3), 16) / 255;
  const g = parseInt(sur.slice(3, 5), 16) / 255;
  const b = parseInt(sur.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#111827" : "#ffffff";
}

// Jeu de valeurs dérivées, calculé une fois et partagé par l'affichage à l'écran et le
// document d'impression : les deux rendus doivent être identiques, or ils sont produits par
// deux chemins différents (React d'un côté, chaînes HTML de l'autre).
export interface PassTheme extends PassDesign {
  mutedColor: string;
  borderColor: string;
  surfaceColor: string;
  onPrimaryColor: string;
}

export function buildPassTheme(brut: PassDesign | null | undefined): PassTheme {
  const design = resolvePassDesign(brut);
  return {
    ...design,
    mutedColor: hexToRgba(design.textColor, 0.55),
    borderColor: hexToRgba(design.textColor, 0.12),
    surfaceColor: hexToRgba(design.textColor, 0.04),
    onPrimaryColor: contrasteSur(design.primaryColor)
  };
}

export function estPassDesignParDefaut(design: PassDesign): boolean {
  return (Object.keys(PASS_DESIGN_PAR_DEFAUT) as Array<keyof PassDesign>)
    .every((champ) => design[champ] === PASS_DESIGN_PAR_DEFAUT[champ]);
}
