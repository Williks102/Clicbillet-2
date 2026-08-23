import { useEffect, useState } from "react";
import { MapPin, Sparkles } from "lucide-react";
import { fetchVendorCategories, iconeDeCategoriePrestataire, TOUTES_CATEGORIES_PRESTATAIRES, VendorCategory } from "../lib/vendorCategories";
import { SkeletonBlock } from "./Skeleton";

export interface VendorSummary {
  id: string;
  alias: string;
  businessName: string;
  city: string;
  description: string | null;
  coverImage: string | null;
  portfolioImages: string[];
  categorySlugs: string[];
  createdAt: string;
}

interface VendorsMarketplacePageProps {
  onViewVendor: (alias: string) => void;
  // Absent pour un visiteur non connecté ou déjà prestataire : le bouton "Devenir prestataire"
  // n'a alors rien d'utile à proposer (cf. App.tsx, qui décide de la présence de ce callback).
  onBecomeVendor?: () => void;
}

// Marché de prestataires événementiels : grille filtrable par catégorie et par ville, jumeau
// dans son esprit de la page d'accueil (catalogue d'événements), mais pour les fiches
// vitrines de photographes, régies, MC, traiteurs...
export default function VendorsMarketplacePage({ onViewVendor, onBecomeVendor }: VendorsMarketplacePageProps) {
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(TOUTES_CATEGORIES_PRESTATAIRES);
  const [city, setCity] = useState("");
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVendorCategories().then(setCategories);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedCategory !== TOUTES_CATEGORIES_PRESTATAIRES) params.set("category", selectedCategory);
    const trimmedCity = city.trim();
    if (trimmedCity) params.set("city", trimmedCity);

    // Léger différé : évite un aller-retour réseau par frappe pendant la saisie de la ville.
    const timer = setTimeout(() => {
      fetch(`/api/vendors?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => { if (!cancelled) setVendors(Array.isArray(data) ? data : []); })
        .catch(() => { if (!cancelled) setVendors([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, trimmedCity ? 300 : 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedCategory, city]);

  return (
    <div id="vendors-marketplace-page" className="space-y-6 py-2">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 sm:text-3xl">Prestataires événementiels</h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Photographes, régies son et lumière, MC, traiteurs, décorateurs... trouvez qui il vous
            faut pour votre prochain événement.
          </p>
        </div>

        {onBecomeVendor && (
          <button
            id="marketplace-become-vendor-btn"
            onClick={onBecomeVendor}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-black text-white shadow-md shadow-orange-100 transition-colors hover:bg-orange-700"
          >
            <Sparkles className="h-4 w-4" />
            Devenir prestataire
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Filtrer par ville"
            className="w-full rounded-full border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setSelectedCategory(TOUTES_CATEGORIES_PRESTATAIRES)}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors ${
              selectedCategory === TOUTES_CATEGORIES_PRESTATAIRES
                ? "border-orange-600 bg-orange-600 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:border-orange-300"
            }`}
          >
            Toutes catégories
          </button>
          {categories.map((cat) => {
            const Icone = iconeDeCategoriePrestataire(cat.icon);
            const selected = selectedCategory === cat.slug;
            return (
              <button
                key={cat.slug}
                onClick={() => setSelectedCategory(cat.slug)}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors ${
                  selected
                    ? "border-orange-600 bg-orange-600 text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:border-orange-300"
                }`}
              >
                <Icone className="h-3.5 w-3.5" />
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Chargement des prestataires en cours</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xs">
              <SkeletonBlock className="h-40 w-full rounded-none" />
              <div className="space-y-3 p-5">
                <SkeletonBlock className="h-4 w-20 rounded-full" />
                <SkeletonBlock className="h-5 w-4/5" />
                <SkeletonBlock className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : vendors.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-16 text-center">
          <p className="text-sm font-bold text-gray-500">Aucun prestataire ne correspond à ces critères.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" id="vendors-grid">
          {vendors.map((vendor) => (
            <button
              key={vendor.id}
              id={`vendor-card-${vendor.id}`}
              onClick={() => onViewVendor(vendor.alias)}
              className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white text-left shadow-xs transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg"
            >
              <div className="h-40 w-full overflow-hidden bg-gray-100">
                {vendor.coverImage ? (
                  <img
                    src={vendor.coverImage}
                    alt={vendor.businessName}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-50 to-gray-50 text-3xl font-black text-orange-200">
                    {vendor.businessName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <div className="flex flex-wrap gap-1">
                  {vendor.categorySlugs.slice(0, 2).map((slug) => {
                    const cat = categories.find((c) => c.slug === slug);
                    return (
                      <span key={slug} className="w-fit rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-orange-600">
                        {cat?.label || slug}
                      </span>
                    );
                  })}
                </div>
                <h3 className="line-clamp-1 text-base font-black text-gray-900 transition-colors group-hover:text-orange-600">
                  {vendor.businessName}
                </h3>
                <p className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  {vendor.city}
                </p>
                {vendor.description && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-gray-500">{vendor.description}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
