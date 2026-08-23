import { useEffect, useRef, useState } from "react";
import { Search, Tag, Sparkles, ChevronRight } from "lucide-react";
import { Event } from "../types";
import { fetchCategories, iconeDeCategorie, cleDeLEvenement, TOUTES_CATEGORIES, type Category } from "../lib/categories";
import { isEventPast } from "../lib/eventStatus";
import EventCard from "./EventCard";
import Reveal from "./Reveal";

interface LandingPageProps {
  events: Event[];
  onViewEvent?: (event: Event) => void;
  userRole?: string;
  onViewOrganizer?: (alias: string) => void;
  onViewVendors?: () => void;
}

export default function LandingPage({ events, onViewEvent, userRole, onViewOrganizer, onViewVendors }: LandingPageProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(TOUTES_CATEGORIES);
  const [categories, setCategories] = useState<Category[]>([]);

  // Le référentiel est chargé une fois puis mis en cache par le module : les puces
  // proviennent de la même source que la liste déroulante du formulaire organisateur.
  useEffect(() => {
    let annule = false;
    fetchCategories().then((liste) => { if (!annule) setCategories(liste); });
    return () => { annule = true; };
  }, []);

  // "Tous" en tête, puis le référentiel dans son ordre d'affichage.
  const puces = [
    { slug: TOUTES_CATEGORIES, label: "Tous", icon: "LayoutGrid" },
    ...categories
  ];
  const categoriesScrollRef = useRef<HTMLDivElement>(null);
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);

  // Défilement automatique en va-et-vient de la barre de catégories : en pause au survol/
  // toucher pour ne pas gêner le clic, et désactivé si l'utilisateur préfère un mouvement
  // réduit (accessibilité).
  useEffect(() => {
    const container = categoriesScrollRef.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let direction: 1 | -1 = 1;
    const speedPxPerTick = 0.6;

    const interval = setInterval(() => {
      if (autoScrollPaused) return;
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll <= 0) return;

      container.scrollLeft += speedPxPerTick * direction;
      if (container.scrollLeft >= maxScroll) direction = -1;
      else if (container.scrollLeft <= 0) direction = 1;
    }, 16);

    return () => clearInterval(interval);
  }, [autoScrollPaused]);

  // Filter events based on search query, selected category, and exclude events whose
  // date is already past (dépublication automatique côté acheteur).
  const filteredEvents = events.filter((evt) => {
    if (isEventPast(evt)) return false;

    const matchesSearch =
      evt.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      evt.venue.toLowerCase().includes(searchTerm.toLowerCase()) ||
      evt.description.toLowerCase().includes(searchTerm.toLowerCase());

    // Comparaison sur la CLÉ, jamais sur le libellé : une différence de casse ou d'accent
    // faisait auparavant disparaître silencieusement l'événement du filtre.
    const matchesCategory =
      selectedCategory === TOUTES_CATEGORIES || cleDeLEvenement(evt) === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6 py-6" id="landing-page-container">
      {/* Elegant Search Input, en tête de page */}
      <section id="search-section">
        <div className="relative">
          <Search className="absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            id="event-search-input"
            type="text"
            placeholder="Rechercher un artiste, lieu, mot-clé..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-gray-200 bg-white py-3.5 pr-4 pl-11 text-sm outline-none shadow-xs transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-100 placeholder:text-gray-400"
          />
        </div>
      </section>

      {/* Categories : cartes icône + libellé, défilement horizontal */}
      <section id="categories-section">
        <div
          ref={categoriesScrollRef}
          onMouseEnter={() => setAutoScrollPaused(true)}
          onMouseLeave={() => setAutoScrollPaused(false)}
          onTouchStart={() => setAutoScrollPaused(true)}
          onTouchEnd={() => setAutoScrollPaused(false)}
          className="-mx-4 flex overflow-x-auto px-4 pb-1 scrollbar-none"
          id="categories-bar"
        >
          <div className="flex space-x-3">
            {puces.map(({ slug, label, icon }) => {
              const Icon = iconeDeCategorie(icon);
              return (
              <button
                key={slug}
                id={`category-btn-${slug}`}
                onClick={() => setSelectedCategory(slug)}
                className={`flex w-24 shrink-0 flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all ${
                  selectedCategory === slug
                    ? "border-orange-200 bg-orange-50 text-orange-600 shadow-sm"
                    : "border-gray-100 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Icon className="h-6 w-6" />
                <span className="text-xs font-bold leading-tight">{label}</span>
              </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bandeau vers le marché de prestataires : un visiteur qui organise un événement a
          souvent besoin d'un photographe, d'une régie ou d'un MC en plus de vendre des billets. */}
      {onViewVendors && (
        <section id="vendors-teaser-section">
          <button
            onClick={onViewVendors}
            className="flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-500 px-5 py-4 text-left text-white shadow-md transition-transform hover:scale-[1.01]"
          >
            <span className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 shrink-0" />
              <span>
                <span className="block text-sm font-black">Besoin d'un prestataire pour votre événement ?</span>
                <span className="block text-xs font-semibold text-orange-50">Photographes, régies, MC, traiteurs... découvrez le marché de prestataires.</span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </button>
        </section>
      )}

      {/* Events Listings grid layout.
          La recherche et les catégories au-dessus ne sont volontairement pas animées : ce sont
          les premiers éléments manipulés à l'arrivée, les faire apparaître retarderait la saisie.

          Le décalage se calcule sur la colonne (i % 3) et non sur le rang global : une rangée
          entre dans l'écran d'un seul tenant, l'apparition la balaie donc de gauche à droite,
          là où un décalage cumulé sur toute la liste ferait attendre plus d'une seconde la
          dernière carte. Sur une colonne (mobile), chaque carte a de toute façon son propre
          déclenchement au défilement, et le décalage résiduel reste imperceptible.

          Les cartes conservées d'un filtrage à l'autre gardent leur clé, donc leur état : seules
          les nouvelles apparaissent, la grille ne rejoue pas l'animation à chaque frappe. */}
      <section id="events-grid-section">
        {filteredEvents.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((evt, i) => (
              <Reveal key={evt.id} delay={(i % 3) * 80}>
                <EventCard
                  event={evt}
                  onViewEvent={onViewEvent}
                  userRole={userRole}
                  onViewOrganizer={onViewOrganizer}
                />
              </Reveal>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-gray-100 py-16 text-center" id="no-events-view">
            <Tag className="mx-auto h-12 w-12 text-gray-300" />
            <h3 className="mt-4 text-base font-bold text-gray-900">Aucun événement trouvé</h3>
            <p className="mt-2 text-xs text-gray-500">Essayez d'ajuster vos critères de recherche ou d'explorer une autre catégorie.</p>
          </div>
        )}
      </section>
    </div>
  );
}
