// Identifiant anonyme persistant côté navigateur, utilisé pour déduplicater le vote gratuit
// des visiteurs non connectés (combiné à l'IP côté serveur). Volontairement simple : ce
// n'est pas une empreinte anti-fraude robuste (un utilisateur peut vider son localStorage
// pour revoter), seulement une dissuasion de base — cf. supabase_setup.sql section 13.
const STORAGE_KEY = "clicbillet-device-fingerprint";

export function getDeviceFingerprint(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const generated = `dfp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    return `dfp-session-${Math.random().toString(36).slice(2, 12)}`;
  }
}
