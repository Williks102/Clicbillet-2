import { useState } from "react";
import { ArrowLeft, Calendar, MapPin, Tag, Users, Share2, Check, Minus, Plus, Hourglass, Ticket as TicketIcon } from "lucide-react";
import { Event } from "../types";
import { isEventPast } from "../lib/eventStatus";
import { EventPageSkeleton } from "./Skeleton";
import { formatTierLabel, getSaleState, formatSaleWindowLabel } from "../lib/ticketTier";

// Page d'un événement, adressable par /e/:id.
//
// C'est l'écran qui rend un événement partageable : jusqu'ici, cliquer sur un événement
// ouvrait directement la fenêtre de paiement, donc il n'existait aucune URL à envoyer sur
// WhatsApp pour un concert précis. Les balises Open Graph correspondantes sont injectées
// côté serveur (cf. server/lib/socialPreview.ts) : les robots d'aperçu n'exécutent pas le
// JavaScript et ne verraient jamais ce composant.

// Mêmes plafonds que la modale de paiement, appliqués aussi côté serveur (validateCheckout).
const MAX_PER_TIER = 10;
const MAX_TOTAL_PER_ORDER = 20;

interface EventPageProps {
  event: Event | null;
  loading: boolean;
  onBack: () => void;
  // La sélection est faite ici, et transmise telle quelle à la modale de paiement : celle-ci
  // ne la redemande pas. Sans ce passage, l'acheteur verrait deux fois le même sélecteur.
  onBuyTicket: (event: Event, quantities: Record<string, number>) => void;
  onViewOrganizer: (alias: string) => void;
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Trois formulations selon ce que l'organisateur a renseigné : sans fin, fin le même jour
// ("de 20:00 à 23:30"), ou fin un autre jour — fréquent pour les soirées qui finissent au
// petit matin, où répéter la date évite de faire croire à une erreur de saisie.
function formatSchedule(evt: { date: string; time: string; endDate?: string | null; endTime?: string | null }): string {
  const start = `${formatFullDate(evt.date)} à ${evt.time}`;
  if (!evt.endDate || !evt.endTime) return start;
  if (evt.endDate === evt.date) {
    return `${formatFullDate(evt.date)} de ${evt.time} à ${evt.endTime}`;
  }
  return `du ${formatFullDate(evt.date)} à ${evt.time} au ${formatFullDate(evt.endDate)} à ${evt.endTime}`;
}

export default function EventPage({ event, loading, onBack, onBuyTicket, onViewOrganizer }: EventPageProps) {
  const [shared, setShared] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  function adjustQuantity(tierName: string, delta: number, available: number) {
    setQuantities((prev) => {
      const current = prev[tierName] || 0;
      const orderTotal = Object.values(prev).reduce((sum, q) => sum + q, 0);
      if (delta > 0 && (current >= MAX_PER_TIER || orderTotal >= MAX_TOTAL_PER_ORDER || current >= available)) {
        return prev;
      }
      return { ...prev, [tierName]: Math.max(0, current + delta) };
    });
  }

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
      <EventPageSkeleton />
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
  const rawTiers = event.ticketTypes && event.ticketTypes.length > 0
    ? event.ticketTypes
    : [{ name: "Standard", price: event.price }];

  // Quotas par tarif : un tarif laissé sans quota est enregistré à 0, pas à null
  // (cf. OrganizerDashboard, `Number(t.total) || 0`). Tester la seule présence de la valeur
  // ferait donc passer pour "épuisé" tout tarif sans quota, et bloquerait sa sélection.
  //
  // On reprend la règle exacte de la carte du catalogue : les quotas par tarif ne font foi
  // que si AU MOINS UN tarif en déclare un ; sinon, tous se partagent la jauge globale de
  // l'événement. Les deux écrans doivent annoncer les mêmes disponibilités.
  const soldByTier = event.ticketsSoldByTier ?? {};
  const hasTierQuotas = rawTiers.some((t) => (t.total ?? 0) > 0);
  const tiers = rawTiers.map((t) => {
    // Fenêtre de vente propre au tarif : hors de sa période, il reste affiché (avec sa date
    // d'ouverture) mais n'est pas sélectionnable — /api/checkout le refuserait de toute façon.
    const saleState = getSaleState(t);
    const quota = hasTierQuotas
      ? Math.max(0, (t.total ?? 0) - (soldByTier[t.name.toLowerCase()] ?? 0))
      : remaining;
    return {
      ...t,
      saleState,
      saleLabel: formatSaleWindowLabel(t),
      available: saleState === "ouverte" ? quota : 0,
    };
  });

  const selected = tiers
    .filter((t) => t.saleState === "ouverte")
    .map((t) => ({ name: t.name, price: Number(t.price) || 0, qty: quantities[t.name] || 0 }))
    .filter((item) => item.qty > 0);
  const totalQuantity = selected.reduce((sum, i) => sum + i.qty, 0);
  const totalPrice = selected.reduce((sum, i) => sum + i.price * i.qty, 0);
  const canBuy = !past && !soldOut && totalQuantity > 0;

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
                  {formatSchedule(event)}
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

          {/* Choix des billets. Il se fait ici, et non dans la fenêtre de paiement : celle-ci
              part directement au récapitulatif avec la sélection reçue. */}
          <div className="mt-6 border-t border-gray-50 pt-5">
            <h2 className="flex items-center gap-1.5 text-sm font-black text-gray-900">
              <Tag className="h-4 w-4 text-orange-600" />
              Choisissez vos billets
            </h2>
            <p className="mt-1 text-[10px] font-semibold text-gray-400">
              Maximum {MAX_PER_TIER} par tarif, {MAX_TOTAL_PER_ORDER} au total par commande.
            </p>

            <div className="mt-3 space-y-2">
              {tiers.map((tier) => {
                const qty = quantities[tier.name] || 0;
                const enVente = tier.saleState === "ouverte";
                const tierSoldOut = enVente && tier.available <= 0;
                return (
                  <div
                    key={tier.name}
                    id={`tier-row-${tier.name}`}
                    className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-all ${
                      qty > 0 ? "border-orange-500 bg-orange-50/50 ring-1 ring-orange-500" : "border-gray-100 bg-white"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className={`text-xs font-black ${qty > 0 ? "text-orange-700" : "text-gray-900"}`}>
                        {formatTierLabel(tier.name)}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] font-bold text-gray-500">
                        {Number(tier.price).toLocaleString("fr-FR")} FCFA
                        {!enVente
                          ? (
                            <span
                              className={`ml-2 font-sans font-bold ${
                                tier.saleState === "a-venir" ? "text-amber-600" : "text-gray-400"
                              }`}
                            >
                              {tier.saleLabel}
                            </span>
                          )
                          : tierSoldOut
                            ? <span className="ml-2 font-sans font-bold text-red-500">Épuisé</span>
                            : (
                              <>
                                <span className="ml-2 font-sans font-semibold text-gray-400">{tier.available} place(s)</span>
                                {tier.saleLabel && (
                                  <span className="ml-2 font-sans font-semibold text-amber-600">{tier.saleLabel}</span>
                                )}
                              </>
                            )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        aria-label={`Retirer un billet ${formatTierLabel(tier.name)}`}
                        onClick={() => adjustQuantity(tier.name, -1, tier.available)}
                        disabled={qty === 0}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-30"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-5 text-center font-mono text-sm font-black tabular-nums text-gray-900">{qty}</span>
                      <button
                        type="button"
                        aria-label={`Ajouter un billet ${formatTierLabel(tier.name)}`}
                        onClick={() => adjustQuantity(tier.name, 1, tier.available)}
                        disabled={!enVente || tierSoldOut || past}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-white transition-colors hover:bg-orange-700 disabled:bg-gray-200 disabled:text-gray-400"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Prévenir de la file AVANT le clic. Seule une mise en vente programmée est
              annonçable à l'avance : une file armée par l'affluence dépend de l'instant, et
              l'annoncer à tort découragerait des acheteurs sur un événement fluide. */}
          {event.scheduledOnsale && !past && !soldOut && (
            <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-100 bg-amber-50 p-3.5">
              <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-[11px] leading-relaxed text-amber-800">
                <strong>Forte affluence attendue.</strong> L'accès au paiement est régulé : vous passerez par une
                file d'attente après avoir choisi vos billets.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-50 pt-5">
            <div>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
                <Users className="h-4 w-4 text-gray-400" />
                {soldOut ? "Complet" : `${remaining.toLocaleString("fr-FR")} place(s) restante(s)`}
              </span>
              {totalQuantity > 0 && (
                <p className="mt-1 text-sm font-black text-gray-900">
                  {totalQuantity} billet{totalQuantity > 1 ? "s" : ""} ·{" "}
                  <span className="text-orange-600">{totalPrice.toLocaleString("fr-FR")} FCFA</span>
                </p>
              )}
            </div>

            <button
              onClick={() => onBuyTicket(event, quantities)}
              disabled={!canBuy}
              id="event-page-buy-btn"
              className="rounded-xl bg-orange-600 px-6 py-3 text-sm font-black text-white transition-colors hover:bg-orange-700 disabled:bg-gray-300"
            >
              {past
                ? "Événement terminé"
                : soldOut
                  ? "Complet"
                  : totalQuantity === 0
                    ? "Choisissez un billet"
                    : "Acheter"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
