import { LayoutGrid, Camera, Video, Music, Lightbulb, Mic2, UtensilsCrossed, Sparkles, ShieldCheck, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabaseClient } from "./supabaseClient";

// Référentiel des catégories de prestataires, jumeau de src/lib/categories.ts (catégories
// d'événements) : même mécanique de lecture (Supabase direct, repli API, repli liste par
// défaut), table séparée (vendor_categories, supabase_setup.sql section 30).

export interface VendorCategory {
  slug: string;
  label: string;
  icon: string;
}

export const TOUTES_CATEGORIES_PRESTATAIRES = "__toutes__";

const ICONES: Record<string, LucideIcon> = {
  LayoutGrid, Camera, Video, Music, Lightbulb, Mic2, UtensilsCrossed, Sparkles, ShieldCheck, Tag,
};

export function iconeDeCategoriePrestataire(nom: string): LucideIcon {
  return ICONES[nom] || Tag;
}

export const VENDOR_CATEGORIES_PAR_DEFAUT: VendorCategory[] = [
  { slug: "photographe", label: "Photographe", icon: "Camera" },
  { slug: "videaste", label: "Vidéaste", icon: "Video" },
  { slug: "dj-regie-son", label: "DJ / Régie son", icon: "Music" },
  { slug: "regie-lumiere", label: "Régie lumière", icon: "Lightbulb" },
  { slug: "mc-animateur", label: "MC / Animateur", icon: "Mic2" },
  { slug: "traiteur", label: "Traiteur", icon: "UtensilsCrossed" },
  { slug: "decoration", label: "Décoration", icon: "Sparkles" },
  { slug: "securite", label: "Sécurité", icon: "ShieldCheck" },
];

let cache: VendorCategory[] | null = null;
let enCours: Promise<VendorCategory[]> | null = null;

export async function fetchVendorCategories(): Promise<VendorCategory[]> {
  if (cache) return cache;
  if (enCours) return enCours;

  enCours = (async () => {
    try {
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from("vendor_categories")
          .select("slug, label, icon")
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (!error && data && data.length > 0) {
          cache = data as VendorCategory[];
          return cache;
        }
      }
    } catch {
      /* repli ci-dessous */
    }

    try {
      const reponse = await fetch("/api/vendor-categories");
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

    cache = VENDOR_CATEGORIES_PAR_DEFAUT;
    return cache;
  })();

  const resultat = await enCours;
  enCours = null;
  return resultat;
}
