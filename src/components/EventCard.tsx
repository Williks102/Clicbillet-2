import { Calendar, Clock, MapPin, Ticket, User as UserIcon } from "lucide-react";
import { Event } from "../types";

interface EventCardProps {
  event: Event;
  // Ouvre la page dédiée de l'événement (/e/:id) : c'est elle qui porte le choix des tarifs
  // et l'URL partageable. La carte ne déclenche plus d'achat directement.
  onViewEvent?: (event: Event) => void;
  userRole?: string;
  onViewOrganizer?: (alias: string) => void;
}

export default function EventCard({ event: evt, onViewEvent, userRole, onViewOrganizer }: EventCardProps) {
  const hasTiers = Array.isArray(evt.ticketTypes) && evt.ticketTypes.length > 0 && evt.ticketTypes.some(t => (t.total ?? 0) > 0);
  const tierAvailability = hasTiers
    ? evt.ticketTypes!.map(t => ({
        name: t.name,
        available: Math.max(0, (t.total ?? 0) - ((evt.ticketsSoldByTier ?? {})[t.name.toLowerCase()] ?? 0))
      }))
    : null;
  const globalRemains = evt.totalTickets - evt.ticketsSold;
  const isSoldOut = hasTiers
    ? tierAvailability!.every(t => t.available <= 0)
    : globalRemains <= 0;

  return (
    <div
      id={`event-card-${evt.id}`}
      // h-full : la carte n'est plus l'élément direct de la grille (elle est enveloppée pour
      // l'apparition au défilement), elle doit donc remplir la hauteur que la grille donne à son
      // conteneur, sans quoi les cartes d'une même rangée perdent leur hauteur commune.
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-xs transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg"
    >
      {/* Event banner illustration, plein cadre sans surcouche. Affiche, titre et bouton
          mènent tous à la page de l'événement : le choix des tarifs s'y fait désormais, et
          c'est elle qui porte l'URL partageable. */}
      <button
        type="button"
        onClick={() => onViewEvent?.(evt)}
        aria-label={`Voir la page de ${evt.title}`}
        className="h-48 w-full overflow-hidden bg-gray-100 text-left"
      >
        <img
          src={evt.banner}
          alt={evt.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          referrerPolicy="no-referrer"
        />
      </button>

      {/* Card Description Elements */}
      <div className="flex flex-1 flex-col p-5 space-y-3">
        <span className="w-fit rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-orange-600">
          {evt.category}
        </span>

        <h3
          onClick={() => onViewEvent?.(evt)}
          className="line-clamp-1 cursor-pointer text-lg font-black text-gray-900 transition-colors group-hover:text-orange-600"
        >
          {evt.title}
        </h3>

        {evt.organizerAlias && onViewOrganizer ? (
          <button
            id={`organizer-link-${evt.id}`}
            onClick={() => onViewOrganizer(evt.organizerAlias!)}
            className="flex items-center gap-1 text-xs font-bold text-orange-600 hover:underline w-fit"
          >
            <UserIcon className="h-3 w-3" />
            <span>Publié par {evt.organizerName}</span>
          </button>
        ) : (
          <p className="flex items-center gap-1 text-xs font-semibold text-gray-400">
            <UserIcon className="h-3 w-3" />
            <span>Publié par {evt.organizerName}</span>
          </p>
        )}

        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-center space-x-2">
            <Calendar className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="font-semibold">
              {new Date(evt.date).toLocaleDateString("fr-FR", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Clock className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="font-semibold">{evt.time}</span>
          </div>
          <div className="flex items-center space-x-2">
            <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="truncate font-semibold">{evt.venue}</span>
          </div>
        </div>

        <p className="text-sm text-gray-500">
          À partir de <span className="text-lg font-black text-orange-600">{evt.price.toLocaleString("fr-FR")} XOF</span>
        </p>

        {/* Stock tracker footer indicators */}
        <div className="flex-1 space-y-3">
          {/* Per-tier availability pills */}
          {hasTiers ? (
            <div className="flex flex-wrap gap-1.5">
              {tierAvailability!.map(t => (
                <span
                  key={t.name}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ${
                    t.available <= 0
                      ? "bg-red-50 text-red-500"
                      : "bg-orange-50 text-orange-700"
                  }`}
                >
                  {t.name}
                  <span className={`rounded px-1 text-[10px] font-black ${t.available <= 0 ? "text-red-400" : "text-orange-600"}`}>
                    {t.available <= 0 ? "Épuisé" : `${t.available} places`}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs">
              {isSoldOut ? (
                <span className="rounded-md bg-red-50 px-2 py-1 font-bold text-red-600">Épuisé</span>
              ) : (
                <span className="text-gray-500 font-medium">
                  <strong className="text-orange-600 font-black">{globalRemains}</strong> places dispo
                </span>
              )}
            </div>
          )}
        </div>

        {userRole === "organizer" ? (
          <div className="w-full rounded-full bg-orange-50 py-3 text-center text-xs font-bold text-orange-700">
            Mode Orga Actif
          </div>
        ) : (
          /* Mène à la page de l'événement, où se fait le choix des tarifs — et non plus
             directement au paiement. Le libellé le dit : "Acheter" sur un bouton qui ouvre
             une page de présentation serait trompeur. */
          <button
            id={`buy-btn-${evt.id}`}
            onClick={() => onViewEvent?.(evt)}
            disabled={isSoldOut}
            className={`flex w-full items-center justify-center space-x-2 rounded-full py-3 text-sm font-bold transition-all active:scale-95 ${
              isSoldOut
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-orange-600 hover:bg-orange-700 text-white shadow-sm shadow-orange-100"
            }`}
          >
            <Ticket className="h-4 w-4" />
            <span>{isSoldOut ? "Complet" : "Voir les billets"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
