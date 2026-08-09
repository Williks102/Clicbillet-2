import { isSupabaseEnabled, supabase } from "./config.js";

// ==========================================
// RÉFÉRENTIEL DES CATÉGORIES
// ==========================================
// Source unique de vérité, en base (cf. supabase_setup.sql section 27). Avant, deux listes
// codées en dur — formulaire organisateur et filtres de l'accueil — devaient s'accorder sans
// rien pour les y forcer, et elles avaient déjà divergé.
//
// Une catégorie a une CLÉ stable (slug) et un LIBELLÉ affiché. Tout ce qui compare, filtre ou
// stocke utilise la clé ; le libellé ne sert qu'à l'affichage et peut donc être renommé sans
// rien casser.

export interface Category {
  slug: string;
  label: string;
  icon: string;
  sortOrder: number;
  active: boolean;
}

// Repli utilisé tant que la section 27 n'a pas été jouée, et en développement local sur
// db.json. Volontairement identique au jeu initial inséré par le script SQL : le comportement
// ne change pas selon que la migration est passée ou non.
export const CATEGORIES_PAR_DEFAUT: Category[] = [
  { slug: "concert", label: "Concert", icon: "Music", sortOrder: 10, active: true },
  { slug: "festivals", label: "Festivals", icon: "PartyPopper", sortOrder: 20, active: true },
  { slug: "theatre-humour", label: "Théâtre & Humour", icon: "Drama", sortOrder: 30, active: true },
  { slug: "sport", label: "Sport", icon: "Trophy", sortOrder: 40, active: true },
  { slug: "professionnel", label: "Professionnel", icon: "Briefcase", sortOrder: 50, active: true },
];

// Même normalisation que slugify_category côté SQL : les deux doivent donner la même clé
// pour un même libellé, sans quoi un événement créé par l'API ne serait pas rattaché à la
// même catégorie que le même événement créé en base.
export function slugifyCategory(texte: string): string {
  return (texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let cache: { valeurs: Category[]; expire: number } | null = null;
const CACHE_MS = 5 * 60_000;

export function inValiderCacheCategories(): void {
  cache = null;
}

// `toutes` inclut les catégories désactivées : nécessaire pour AFFICHER un événement qui en
// porte une (héritée d'une saisie libre), alors qu'on ne veut plus la PROPOSER.
export async function getCategories(toutes = false): Promise<Category[]> {
  if (cache && cache.expire > Date.now()) {
    return toutes ? cache.valeurs : cache.valeurs.filter((c) => c.active);
  }
  if (!isSupabaseEnabled || !supabase) {
    return toutes ? CATEGORIES_PAR_DEFAUT : CATEGORIES_PAR_DEFAUT.filter((c) => c.active);
  }
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("slug, label, icon, sort_order, active")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const valeurs: Category[] = (data || []).map((r: any) => ({
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
      `[Catégories] Référentiel indisponible (${err?.message}) : repli sur la liste par défaut. ` +
      `Jouez la section 27 de supabase_setup.sql.`
    );
    return toutes ? CATEGORIES_PAR_DEFAUT : CATEGORIES_PAR_DEFAUT.filter((c) => c.active);
  }
}

// Résout ce qu'envoie un client — une clé ("concert") ou un libellé ("Concert", "  CONCERT ")
// — en catégorie du référentiel. Renvoie null si elle n'existe pas ou n'est plus proposée,
// ce que l'appelant traduit en refus : c'est ce contrôle qui remplace l'ancien "n'importe
// quel texte de moins de 100 caractères".
export async function resoudreCategorie(saisie: string): Promise<Category | null> {
  const cle = slugifyCategory(String(saisie || ""));
  if (!cle) return null;
  const actives = await getCategories();
  return actives.find((c) => c.slug === cle) || null;
}
