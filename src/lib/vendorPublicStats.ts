import { cachedFetch } from "./fetchCache";

// Preuve sociale publique du marché de prestataires (cf. GET /api/vendor-stats/public,
// server/routes/vendors.ts) : juste de quoi rassurer un visiteur, jamais le détail par
// catégorie ou prestataire (réservé à l'admin).
export interface VendorPublicStats {
  activeVendors: number;
  leadsLast30Days: number;
}

export async function fetchVendorPublicStats(): Promise<VendorPublicStats> {
  try {
    return await cachedFetch<VendorPublicStats>("/api/vendor-stats/public", { ttlMs: 5 * 60_000 });
  } catch {
    return { activeVendors: 0, leadsLast30Days: 0 };
  }
}
