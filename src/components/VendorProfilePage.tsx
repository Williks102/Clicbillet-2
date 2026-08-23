import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, MessageCircleMore, Images } from "lucide-react";
import { EventGridSkeleton, SkeletonBlock } from "./Skeleton";
import { fetchVendorCategories, iconeDeCategoriePrestataire, VendorCategory } from "../lib/vendorCategories";
import VendorContactModal from "./VendorContactModal";
import { VendorSummary } from "./VendorsMarketplacePage";

interface VendorProfilePageProps {
  alias: string;
  onBack: () => void;
}

// Fiche publique d'un prestataire (/p/:alias), jumeau d'OrganizerProfilePage.tsx : en-tête,
// portfolio, et ici un appel à l'action "Demander un devis" plutôt qu'une liste d'événements.
export default function VendorProfilePage({ alias, onBack }: VendorProfilePageProps) {
  const [vendor, setVendor] = useState<VendorSummary | null>(null);
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  useEffect(() => {
    fetchVendorCategories().then(setCategories);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/vendors/${encodeURIComponent(alias)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setVendor(data.vendor);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [alias]);

  if (loading) {
    return (
      <div id="vendor-profile-loader">
        <SkeletonBlock className="h-32 w-full rounded-3xl" />
        <div className="mt-6">
          <EventGridSkeleton count={3} withFilters={false} />
        </div>
      </div>
    );
  }

  if (notFound || !vendor) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center" id="vendor-profile-not-found">
        <Images className="mx-auto h-12 w-12 text-gray-300" />
        <h3 className="mt-4 text-base font-bold text-gray-900">Prestataire introuvable</h3>
        <p className="mt-2 text-xs text-gray-500">Cet alias ne correspond à aucune fiche prestataire active.</p>
        <button
          onClick={onBack}
          className="mt-6 flex min-h-11 items-center space-x-1.5 mx-auto text-xs sm:min-h-0 font-bold text-gray-500 hover:text-orange-600"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Retour à l'accueil</span>
        </button>
      </div>
    );
  }

  const categoryLabels = vendor.categorySlugs.map((slug) => categories.find((c) => c.slug === slug)?.label || slug);

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 flex min-h-11 items-center space-x-1.5 text-xs sm:mb-6 sm:min-h-0 font-bold text-gray-500 transition-colors hover:text-orange-600"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Retour</span>
      </button>

      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 text-white shadow-xl">
        {vendor.coverImage && (
          <div className="h-48 w-full overflow-hidden sm:h-64">
            <img src={vendor.coverImage} alt={vendor.businessName} className="h-full w-full object-cover" />
          </div>
        )}
        <div className="px-6 py-10 sm:px-10 sm:py-12">
          {!vendor.coverImage && (
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/50 bg-white/15 text-2xl font-black">
              {vendor.businessName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {categoryLabels.map((label, i) => {
              const Icone = iconeDeCategoriePrestataire(categories.find((c) => c.label === label)?.icon || "Tag");
              return (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider">
                  <Icone className="h-3 w-3" />
                  {label}
                </span>
              );
            })}
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{vendor.businessName}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-orange-50">
            <MapPin className="h-4 w-4" />
            {vendor.city}
          </p>
          {vendor.description && (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-orange-50">{vendor.description}</p>
          )}
          <button
            onClick={() => setContactOpen(true)}
            id="vendor-request-quote-button"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-black text-orange-700 shadow-lg transition-transform hover:scale-105"
          >
            <MessageCircleMore className="h-4 w-4" />
            Demander un devis
          </button>
        </div>
      </div>

      {vendor.portfolioImages.length > 0 && (
        <section className="mt-10" id="vendor-profile-portfolio">
          <h2 className="mb-5 text-base font-extrabold text-gray-900">Portfolio</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {vendor.portfolioImages.map((src, i) => (
              <div key={i} className="aspect-square overflow-hidden rounded-2xl bg-gray-100">
                <img src={src} alt={`${vendor.businessName} — photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </section>
      )}

      {contactOpen && (
        <VendorContactModal
          vendorAlias={vendor.alias}
          vendorName={vendor.businessName}
          onClose={() => setContactOpen(false)}
        />
      )}
    </div>
  );
}
