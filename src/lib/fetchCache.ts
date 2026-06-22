// Cache mémoire très simple (TTL) pour éviter de re-fetch les mêmes données publiques
// (ex: liste d'événements) à chaque changement d'onglet/navigation dans la même session.
// Volontairement minimal : pas de librairie de data-fetching, juste une Map + horodatage.
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

interface CachedFetchOptions {
  /** Durée de fraîcheur en millisecondes avant de re-fetch. */
  ttlMs?: number;
  /** Ignore le cache et force un re-fetch (ex: après une mutation connue). */
  force?: boolean;
}

export async function cachedFetch<T>(url: string, options: CachedFetchOptions = {}): Promise<T> {
  const { ttlMs = 20_000, force = false } = options;

  if (!force) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.data as T;
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Échec de la requête ${url} (HTTP ${response.status}).`);
  }
  const data: T = await response.json();
  cache.set(url, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

export function invalidateCachedFetch(url: string) {
  cache.delete(url);
}
