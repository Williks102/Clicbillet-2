// Règles de validation pour l'alias public d'un prestataire (page /p/:alias), jumeau de
// server/lib/organizerAlias.ts. Colonne séparée (vendor_profiles.alias) : un compte peut être
// organisateur ET prestataire, avec deux alias publics indépendants.
const ALIAS_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 30;

// Évite les alias qui entreraient en collision avec une route existante ou prêteraient à
// confusion.
const RESERVED_ALIASES = new Set([
  "admin", "api", "www", "app", "o", "p", "organisateur", "organizer",
  "prestataire", "prestataires", "vendor", "vendors",
  "profil", "profile", "clicbillet", "support", "contact", "aide", "help",
]);

export function validateVendorAlias(raw: string): { valid: boolean; alias: string; error?: string } {
  const alias = (raw || "").trim().toLowerCase();

  if (alias.length < MIN_LENGTH || alias.length > MAX_LENGTH) {
    return { valid: false, alias, error: `L'alias doit contenir entre ${MIN_LENGTH} et ${MAX_LENGTH} caractères.` };
  }
  if (!ALIAS_REGEX.test(alias)) {
    return { valid: false, alias, error: "L'alias ne peut contenir que des lettres minuscules, chiffres et tirets simples (pas au début/à la fin)." };
  }
  if (RESERVED_ALIASES.has(alias)) {
    return { valid: false, alias, error: "Cet alias est réservé, choisissez-en un autre." };
  }

  return { valid: true, alias };
}

export const MAX_VENDOR_DESCRIPTION_LENGTH = 1000;
