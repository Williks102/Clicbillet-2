import { isSupabaseEnabled, supabase } from "./config.js";
import { slugifyCategory } from "./categories.js";

// ==========================================
// RÉFÉRENTIEL DES CATÉGORIES DE PRESTATAIRES
// ==========================================
// Même principe que server/lib/categories.ts (référentiel des catégories d'événements), pour
// le marché des prestataires (photographe, régie, MC...) : une table à part
// (supabase_setup.sql section 30), pas mélangée aux catégories d'événements — les deux listes
// n'ont pas vocation à évoluer ensemble.

export interface VendorCategory {
  slug: string;
  label: string;
  icon: string;
  sortOrder: number;
  active: boolean;
}

export { slugifyCategory };

// Repli utilisé tant que la section 30 n'a pas été jouée, et en développement local sur
// db.json. Identique au jeu initial inséré par le script SQL.
export const VENDOR_CATEGORIES_PAR_DEFAUT: VendorCategory[] = [
  { slug: "photographe", label: "Photographe", icon: "Camera", sortOrder: 10, active: true },
  { slug: "videaste", label: "Vidéaste", icon: "Video", sortOrder: 20, active: true },
  { slug: "dj-regie-son", label: "DJ / Régie son", icon: "Music", sortOrder: 30, active: true },
  { slug: "regie-lumiere", label: "Régie lumière", icon: "Lightbulb", sortOrder: 40, active: true },
  { slug: "mc-animateur", label: "MC / Animateur", icon: "Mic2", sortOrder: 50, active: true },
  { slug: "traiteur", label: "Traiteur", icon: "UtensilsCrossed", sortOrder: 60, active: true },
  { slug: "decoration", label: "Décoration", icon: "Sparkles", sortOrder: 70, active: true },
  { slug: "securite", label: "Sécurité", icon: "ShieldCheck", sortOrder: 80, active: true },
];

let cache: { valeurs: VendorCategory[]; expire: number } | null = null;
const CACHE_MS = 5 * 60_000;

export function inValiderCacheVendorCategories(): void {
  cache = null;
}

// `toutes` inclut les catégories désactivées : nécessaire pour AFFICHER une fiche prestataire
// qui en porte une, alors qu'on ne veut plus la PROPOSER à la création.
export async function getVendorCategories(toutes = false): Promise<VendorCategory[]> {
  if (cache && cache.expire > Date.now()) {
    return toutes ? cache.valeurs : cache.valeurs.filter((c) => c.active);
  }
  if (!isSupabaseEnabled || !supabase) {
    return toutes ? VENDOR_CATEGORIES_PAR_DEFAUT : VENDOR_CATEGORIES_PAR_DEFAUT.filter((c) => c.active);
  }
  try {
    const { data, error } = await supabase
      .from("vendor_categories")
      .select("slug, label, icon, sort_order, active")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const valeurs: VendorCategory[] = (data || []).map((r: any) => ({
      slug: r.slug,
      label: r.label,
      icon: r.icon || "Tag",
      sortOrder: Number(r.sort_order) || 100,
      active: r.active !== false,
    }));
    if (valeurs.length === 0) throw new Error("référentiel vide");
    cache = { valeurs, expire: Date.now() + CACHE_MS };
    return toutes ? valeurs : valeurs.filter((c) => c.active);
  } catch (err: any) {
    console.warn(
      `[Catégories prestataires] Référentiel indisponible (${err?.message}) : repli sur la liste par défaut. ` +
      `Jouez la section 30 de supabase_setup.sql.`
    );
    return toutes ? VENDOR_CATEGORIES_PAR_DEFAUT : VENDOR_CATEGORIES_PAR_DEFAUT.filter((c) => c.active);
  }
}
