import { LayoutGrid, Music, PartyPopper, Drama, Trophy, Briefcase, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabaseClient } from "./supabaseClient";

// Référentiel des catégories côté navigateur.
//
// Une seule liste, lue depuis la base, alimente le formulaire organisateur ET les filtres du
// catalogue. Auparavant chacun avait la sienne, codée en dur dans son propre fichier : elles
// avaient divergé, et "Professionnel" pouvait être choisi à la création sans avoir de puce de
// filtre correspondante.

export interface Category {
  slug: string;
  label: string;
  icon: string;
}

// Clé conventionnelle du filtre "toutes catégories". Ce n'est pas une catégorie du
// référentiel : elle n'est jamais stockée sur un événement.
export const TOUTES_CATEGORIES = "__toutes__";

// Correspondance explicite nom d'icône -> composant. Un nom inconnu (catégorie ajoutée en
// base avec une icône non prévue ici) retombe sur une icône neutre : une catégorie inédite
// s'affiche sans icône dédiée plutôt que de casser le rendu de la page d'accueil.
const ICONES: Record<string, LucideIcon> = {
  LayoutGrid, Music, PartyPopper, Drama, Trophy, Briefcase, Tag,
};

export function iconeDeCategorie(nom: string): LucideIcon {
  return ICONES[nom] || Tag;
}

// Même repli que côté serveur (server/lib/categories.ts) : tant que la section 27 n'est pas
// jouée, l'application se comporte exactement comme avant.
export const CATEGORIES_PAR_DEFAUT: Category[] = [
  { slug: "concert", label: "Concert", icon: "Music" },
  { slug: "festivals", label: "Festivals", icon: "PartyPopper" },
  { slug: "theatre-humour", label: "Théâtre & Humour", icon: "Drama" },
  { slug: "sport", label: "Sport", icon: "Trophy" },
  { slug: "professionnel", label: "Professionnel", icon: "Briefcase" },
];

let cache: Category[] | null = null;
let enCours: Promise<Category[]> | null = null;

export async function fetchCategories(): Promise<Category[]> {
  if (cache) return cache;
  if (enCours) return enCours;

  enCours = (async () => {
    // Lecture directe depuis Supabase quand elle est configurée, comme le catalogue
    // (cf. src/lib/publicEvents.ts) : évite de dépendre du démarrage à froid de la fonction
    // serverless sur la page la plus visitée. Repli sur l'API, puis sur la liste par défaut.
    try {
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from("categories")
          .select("slug, label, icon")
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (!error && data && data.length > 0) {
          cache = data as Category[];
          return cache;
        }
      }
    } catch {
      /* repli ci-dessous */
    }

    try {
      const reponse = await fetch("/api/categories");
      if (reponse.ok) {
        const data = await reponse.json();
        if (Array.isArray(data) && data.length > 0) {
          cache = data.map((c: any) => ({ slug: c.slug, label: c.label, icon: c.icon }));
          return cache;
        }
      }
    } catch {
      /* repli ci-dessous */
    }

    cache = CATEGORIES_PAR_DEFAUT;
    return cache;
  })();

  const resultat = await enCours;
  enCours = null;
  return resultat;
}

// Un événement d'avant la migration peut n'avoir que son libellé : on retrouve alors sa clé
// en la normalisant, exactement comme le fait slugify_category côté base.
export function slugifyCategory(texte: string): string {
  return (texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cleDeLEvenement(evt: { categorySlug?: string | null; category?: string }): string {
  return evt.categorySlug || slugifyCategory(evt.category || "");
}
