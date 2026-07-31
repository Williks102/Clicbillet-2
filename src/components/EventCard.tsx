import { Calendar, MapPin, ArrowRight, User as UserIcon } from "lucide-react";
import { Event } from "../types";

interface EventCardProps {
  event: Event;
  onBuyTicket: (event: Event) => void;
  userRole?: string;
  onViewOrganizer?: (alias: string) => void;
}

export default function EventCard({ event: evt, onBuyTicket, userRole, onViewOrganizer }: EventCardProps) {
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
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-xs transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg"
    >
      {/* Event banner illustration */}
      <div className="relative h-48 w-full overflow-hidden bg-gray-100">
        <img
          src={evt.banner}
          alt={evt.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          referrerPolicy="no-referrer"
        />
        <div className="absolute top-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur-xs">
          {evt.category}
        </div>

        {/* Left places indicator tag */}
        <div className="absolute bottom-3 right-3 rounded-lg bg-orange-600/95 px-2.5 py-1 text-xs font-bold text-white shadow-md">
          {evt.price.toLocaleString("fr-FR")} XOF
        </div>
      </div>

      {/* Card Description Elements */}
      <div className="flex flex-1 flex-col p-5">
        <h3 className="line-clamp-1 text-base font-extrabold text-gray-900 group-hover:text-orange-600 transition-colors">
          {evt.title}
        </h3>

        {evt.organizerAlias && onViewOrganizer ? (
          <button
            id={`organizer-link-${evt.id}`}
            onClick={() => onViewOrganizer(evt.organizerAlias!)}
            className="mt-1 flex items-center gap-1 text-xs font-bold text-orange-600 hover:underline w-fit"
          >
            <UserIcon className="h-3 w-3" />
            {evt.organizerName}
          </button>
        ) : (
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-gray-400">
            <UserIcon className="h-3 w-3" />
            {evt.organizerName}
          </p>
        )}

        <p className="mt-2 line-clamp-2 flex-1 text-xs text-gray-500 leading-relaxed">
          {evt.description}
        </p>

        <div className="mt-4 space-y-2 border-t border-gray-50 pt-4 text-xs text-gray-600">
          <div className="flex items-center space-x-2">
            <Calendar className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="font-semibold">
              {new Date(evt.date).toLocaleDateString("fr-FR", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}{" "}
              à {evt.time}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="truncate font-semibold">{evt.venue}</span>
          </div>
        </div>

        {/* Stock tracker footer indicators */}
        <div className="mt-4 space-y-3">
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

          <div className="flex items-center justify-end">

          {userRole === "organizer" ? (
            <div className="rounded-full bg-orange-50 px-3 py-1.5 text-[11px] font-bold text-orange-700">
              Mode Orga Actif
            </div>
          ) : (
            <button
              id={`buy-btn-${evt.id}`}
              onClick={() => onBuyTicket(evt)}
              disabled={isSoldOut}
              className={`flex items-center space-x-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all active:scale-95 ${
                isSoldOut
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-orange-600 hover:bg-orange-700 text-white shadow-sm shadow-orange-100"
              }`}
            >
              <span>Acheter</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
