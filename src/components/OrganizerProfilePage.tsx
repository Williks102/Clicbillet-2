import { useEffect, useState } from "react";
import { ArrowLeft, User as UserIcon, Ticket as TicketIcon } from "lucide-react";
import { Event } from "../types";
import { isEventPast } from "../lib/eventStatus";
import { EventGridSkeleton, SkeletonBlock } from "./Skeleton";
import EventCard from "./EventCard";

interface OrganizerProfile {
  id: string;
  name: string;
  alias: string;
  bio: string | null;
}

interface OrganizerProfilePageProps {
  alias: string;
  onBack: () => void;
  onViewEvent?: (event: Event) => void;
}

export default function OrganizerProfilePage({ alias, onBack, onViewEvent }: OrganizerProfilePageProps) {
  const [organizer, setOrganizer] = useState<OrganizerProfile | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`/api/organizers/${encodeURIComponent(alias)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setOrganizer(data.organizer);
        setEvents(data.events || []);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [alias]);

  const upcomingEvents = events.filter((evt) => !isEventPast(evt));

  if (loading) {
    return (
      <div id="organizer-profile-loader">
        {/* En-tête d'organisateur puis ses affiches : la grille annonce déjà la forme réelle. */}
        <SkeletonBlock className="h-32 w-full rounded-3xl" />
        <div className="mt-6">
          <EventGridSkeleton count={3} withFilters={false} />
        </div>
      </div>
    );
  }

  if (notFound || !organizer) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center" id="organizer-profile-not-found">
        <UserIcon className="mx-auto h-12 w-12 text-gray-300" />
        <h3 className="mt-4 text-base font-bold text-gray-900">Organisateur introuvable</h3>
        <p className="mt-2 text-xs text-gray-500">Cet alias ne correspond à aucun organisateur actif.</p>
        <button
          onClick={onBack}
          className="mt-6 flex items-center space-x-1.5 mx-auto text-xs font-bold text-gray-500 hover:text-orange-600"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Retour à l'accueil</span>
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-6 flex items-center space-x-1.5 text-xs font-bold text-gray-500 transition-colors hover:text-orange-600"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Retour à l'accueil</span>
      </button>

      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 text-white shadow-xl">
        <div className="px-6 py-10 sm:px-10 sm:py-12">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/50 bg-white/15 text-2xl font-black">
            {organizer.name.slice(0, 1).toUpperCase()}
          </div>
          <h1 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">{organizer.name}</h1>
          <p className="mt-1 text-sm font-bold text-orange-50">@{organizer.alias}</p>
          {organizer.bio && (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-orange-50">{organizer.bio}</p>
          )}
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold">
            <TicketIcon className="h-3.5 w-3.5" />
            {upcomingEvents.length} événement{upcomingEvents.length > 1 ? "s" : ""} actif{upcomingEvents.length > 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <section className="mt-10" id="organizer-profile-events">
        <h2 className="mb-5 text-base font-extrabold text-gray-900">Événements à venir</h2>
        {upcomingEvents.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingEvents.map((evt) => (
              <EventCard key={evt.id} event={evt} onViewEvent={onViewEvent} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-gray-100 py-16 text-center">
            <TicketIcon className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-xs font-semibold text-gray-500">Aucun événement actif pour le moment.</p>
          </div>
        )}
      </section>
    </div>
  );
}
