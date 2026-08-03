import { useEffect, useRef, useState } from "react";
import { Search, Tag, LayoutGrid, Music, PartyPopper, Drama, Trophy } from "lucide-react";
import { Event } from "../types";
import { isEventPast } from "../lib/eventStatus";
import EventCard from "./EventCard";

interface LandingPageProps {
  events: Event[];
  onBuyTicket: (event: Event) => void;
  userRole?: string;
  onViewOrganizer?: (alias: string) => void;
}

const CATEGORIES = [
  { label: "Tous", icon: LayoutGrid },
  { label: "Concert", icon: Music },
  { label: "Festivals", icon: PartyPopper },
  { label: "Théâtre & Humour", icon: Drama },
  { label: "Sport", icon: Trophy }
];

export default function LandingPage({ events, onBuyTicket, userRole, onViewOrganizer }: LandingPageProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Tous");
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

    const matchesCategory =
      selectedCategory === "Tous" || evt.category === selectedCategory;

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
            {CATEGORIES.map(({ label, icon: Icon }) => (
              <button
                key={label}
                id={`category-btn-${label.toLowerCase().replace(/\s/g, "-")}`}
                onClick={() => setSelectedCategory(label)}
                className={`flex w-24 shrink-0 flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all ${
                  selectedCategory === label
                    ? "border-orange-200 bg-orange-50 text-orange-600 shadow-sm"
                    : "border-gray-100 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Icon className="h-6 w-6" />
                <span className="text-xs font-bold leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Events Listings grid layout */}
      <section id="events-grid-section">
        {filteredEvents.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((evt) => (
              <EventCard
                key={evt.id}
                event={evt}
                onBuyTicket={onBuyTicket}
                userRole={userRole}
                onViewOrganizer={onViewOrganizer}
              />
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
