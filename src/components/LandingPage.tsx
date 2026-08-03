import { useState } from "react";
import { Search, Tag, Sparkles, Filter, Rocket, Lock, Smartphone } from "lucide-react";
import { Event } from "../types";
import { isEventPast } from "../lib/eventStatus";
import EventCard from "./EventCard";

interface LandingPageProps {
  events: Event[];
  onBuyTicket: (event: Event) => void;
  userRole?: string;
  onViewOrganizer?: (alias: string) => void;
}

const CATEGORIES = ["Tous", "Concert", "Festivals", "Théâtre & Humour", "Sport"];

export default function LandingPage({ events, onBuyTicket, userRole, onViewOrganizer }: LandingPageProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Tous");

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
    <div className="space-y-10 py-6" id="landing-page-container">
      {/* Hero Showcase banner tailored for Ivorian market */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 text-white shadow-xl">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white/25 via-transparent to-transparent opacity-60" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 py-12 text-center sm:px-12 sm:py-16 md:py-20">
          <span className="inline-flex items-center space-x-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-100">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Billetterie 100% Ivoirienne</span>
          </span>
          <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">
            Vos événements préférés en un seul clic !
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-sm text-orange-50 sm:text-base">
            Achetez vos tickets de concerts, festivals, matchs de foot ou spectacles d'humour en toute sécurité avec Orange Money, MTN, Moov, Wave et cartes bancaires.
          </p>

          {/* Quick instructions indicator */}
          <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs font-semibold text-amber-50">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/15 px-3 py-1.5 backdrop-blur-xs">
              <Rocket className="h-3.5 w-3.5" />
              <span>Tickets Instantanés</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/15 px-3 py-1.5 backdrop-blur-xs">
              <Lock className="h-3.5 w-3.5" />
              <span>Transactions Sécurisées</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/15 px-3 py-1.5 backdrop-blur-xs">
              <Smartphone className="h-3.5 w-3.5" />
              <span>QR Code de Vérification</span>
            </span>
          </div>
        </div>
      </section>

      {/* Control panel: search input & filtering categories */}
      <section className="space-y-6" id="search-filter-section">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Elegant Search Input */}
          <div className="relative flex-1 max-w-md">
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

          {/* Custom label tags filters */}
          <div className="flex items-center space-x-2 text-sm font-bold text-gray-500">
            <Filter className="h-4 w-4 text-orange-600" />
            <span>Filtrer par :</span>
          </div>
        </div>

        {/* Categories Pills bar */}
        <div className="-mx-4 flex overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 scrollbar-none" id="categories-bar">
          <div className="flex space-x-2.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                id={`category-btn-${cat.toLowerCase().replace(/\s/g, "-")}`}
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap rounded-full px-5 py-2.5 text-xs font-bold tracking-wide transition-all ${
                  selectedCategory === cat
                    ? "bg-orange-600 text-white shadow-md shadow-orange-100"
                    : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-100"
                }`}
              >
                {cat}
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
