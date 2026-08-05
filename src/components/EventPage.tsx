import { useState } from "react";
import { ArrowLeft, Calendar, MapPin, Tag, Users, Share2, Check, Ticket as TicketIcon } from "lucide-react";
import { Event } from "../types";
import { isEventPast } from "../lib/eventStatus";
import { formatTierLabel } from "../lib/ticketTier";

// Page d'un événement, adressable par /e/:id.
//
// C'est l'écran qui rend un événement partageable : jusqu'ici, cliquer sur un événement
// ouvrait directement la fenêtre de paiement, donc il n'existait aucune URL à envoyer sur
// WhatsApp pour un concert précis. Les balises Open Graph correspondantes sont injectées
// côté serveur (cf. server/lib/socialPreview.ts) : les robots d'aperçu n'exécutent pas le
// JavaScript et ne verraient jamais ce composant.

interface EventPageProps {
  event: Event | null;
  loading: boolean;
  onBack: () => void;
  onBuyTicket: (event: Event) => void;
  onViewOrganizer: (alias: string) => void;
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function EventPage({ event, loading, onBack, onBuyTicket, onViewOrganizer }: EventPageProps) {
  const [shared, setShared] = useState(false);

  async function handleShare() {
    const url = window.location.href;
    const title = event?.title || "ClicBillet";
    // Partage natif quand le navigateur le propose (Android/iOS) : c'est le chemin direct vers
    // WhatsApp. Sinon, copie du lien dans le presse-papiers.
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `${title} — billets sur ClicBillet`, url });
        return;
      } catch {
        // Partage annulé par l'utilisateur : on ne bascule pas sur la copie, il a choisi.
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2500);
    } catch {
      // Presse-papiers refusé : l'URL reste visible dans la barre d'adresse.
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" id="event-page-loader">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center" id="event-page-not-found">
        <TicketIcon className="h-12 w-12 text-gray-300" />
        <h1 className="mt-4 text-lg font-black text-gray-900">Événement introuvable</h1>
        <p className="mt-2 max-w-sm text-xs leading-relaxed text-gray-500">
          Ce lien ne correspond à aucun événement en vente. Il a peut-être été retiré, ou l'adresse est incomplète.
        </p>
        <button
          onClick={onBack}
          className="mt-6 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-black text-white transition-colors hover:bg-orange-700"
        >
          Voir tous les événements
        </button>
      </div>
    );
  }

  const past = isEventPast(event);
  const remaining = Math.max(0, (Number(event.totalTickets) || 0) - (Number(event.ticketsSold) || 0));
  const soldOut = remaining <= 0;
  const tiers = event.ticketTypes && event.ticketTypes.length > 0
    ? event.ticketTypes
    : [{ name: "Standard", price: event.price }];

  return (
    <div className="mx-auto max-w-3xl py-6" id="event-page">
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-xs font-bold text-gray-500 transition-colors hover:text-orange-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Tous les événements
      </button>

      <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
        {event.banner && (
          <img
            src={event.banner}
            alt={event.title}
            className="h-52 w-full object-cover sm:h-72"
          />
        )}

        <div className="p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-block rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-orange-700">
                {event.category}
              </span>
              <h1 className="mt-2 text-xl font-black text-gray-950 sm:text-2xl">{event.title}</h1>
              <p className="mt-1 text-xs font-semibold text-gray-500">
                Organisé par{" "}
                {event.organizerAlias ? (
                  <button
                    onClick={() => onViewOrganizer(event.organizerAlias!)}
                    className="font-bold text-orange-600 hover:underline"
                  >
                    {event.organizerName}
                  </button>
                ) : (
                  <span className="font-bold text-gray-700">{event.organizerName}</span>
                )}
              </p>
            </div>

            <button
              onClick={handleShare}
              id="event-share-btn"
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-black text-gray-700 transition-colors hover:border-orange-200 hover:text-orange-600"
            >
              {shared ? <Check className="h-4 w-4 text-green-600" /> : <Share2 className="h-4 w-4" />}
              {shared ? "Lien copié" : "Partager"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2.5 rounded-2xl bg-gray-50 p-3.5">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Date</p>
                <p className="text-xs font-bold text-gray-900 first-letter:uppercase">
                  {formatFullDate(event.date)} à {event.time}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-2xl bg-gray-50 p-3.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">Lieu</p>
                <p className="text-xs font-bold text-gray-900">{event.venue}</p>
              </div>
            </div>
          </div>

          {event.description && (
            <p className="mt-5 text-sm leading-relaxed whitespace-pre-wrap text-gray-600">{event.description}</p>
          )}

          <div className="mt-6 border-t border-gray-50 pt-5">
            <h2 className="flex items-center gap-1.5 text-sm font-black text-gray-900">
              <Tag className="h-4 w-4 text-orange-600" />
              Tarifs
            </h2>
            <div className="mt-3 space-y-2">
              {tiers.map((tier) => (
                <div
                  key={tier.name}
                  className="flex items-center justify-between rounded-2xl border border-gray-100 px-4 py-3"
                >
                  <span className="text-xs font-bold text-gray-800">{formatTierLabel(tier.name)}</span>
                  <span className="font-mono text-sm font-black text-orange-600">
                    {Number(tier.price).toLocaleString("fr-FR")} FCFA
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-50 pt-5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
              <Users className="h-4 w-4 text-gray-400" />
              {soldOut ? "Complet" : `${remaining.toLocaleString("fr-FR")} place(s) restante(s)`}
            </span>

            <button
              onClick={() => onBuyTicket(event)}
              disabled={past || soldOut}
              id="event-page-buy-btn"
              className="rounded-xl bg-orange-600 px-6 py-3 text-sm font-black text-white transition-colors hover:bg-orange-700 disabled:bg-gray-300"
            >
              {past ? "Événement terminé" : soldOut ? "Complet" : "Acheter un billet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
