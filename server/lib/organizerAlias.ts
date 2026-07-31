// Règles de validation pour l'alias public d'un organisateur (page /o/:alias). Partagées
// entre la vérification de disponibilité en direct et la sauvegarde du profil, pour ne
// jamais accepter côté écriture un alias que la vérification aurait refusé.
const ALIAS_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 30;

// Évite les alias qui entreraient en collision avec une route existante ou prêteraient à
// confusion (ex: quelqu'un partageant "clicbillet.ci/o/admin").
const RESERVED_ALIASES = new Set([
  "admin", "api", "www", "app", "o", "organisateur", "organizer",
  "profil", "profile", "clicbillet", "support", "contact", "aide", "help",
]);

// Forme "plate" (pas d'union discriminée) : ce projet n'active pas strictNullChecks
// (tsconfig.json), sous lequel le rétrécissement de type sur "valid" ne s'applique pas
// fiablement. "alias" est donc toujours renseigné (normalisé), "error" seulement si invalide.
export function validateOrganizerAlias(raw: string): { valid: boolean; alias: string; error?: string } {
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

export const MAX_ORGANIZER_BIO_LENGTH = 280;
