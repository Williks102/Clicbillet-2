import { useMemo, useState } from "react";
import { Table2, TrendingUp, Users, Ticket as TicketIcon, ScanLine, Wallet, ShoppingCart } from "lucide-react";
import { Event, SalesStatus } from "../types";
import { isPaidTicket } from "../lib/ticketPayment";
import { formatTierLabel } from "../lib/ticketTier";
import { isEventPast } from "../lib/eventStatus";

// Onglet "Rapports" de l'espace organisateur : les indicateurs usuels de la billetterie
// événementielle, tous dérivés des données déjà renvoyées par /api/organizer/stats — aucun
// appel réseau supplémentaire.
//
// Ce que le secteur regarde, et pourquoi c'est ici :
//   - CA brut vs net encaissé  : ce que l'organisateur touche réellement, commission déduite
//   - Prix moyen du billet      : mix tarifaire réel, au-delà du prix affiché
//   - Taux de remplissage       : billets vendus rapportés à la jauge (sell-through)
//   - Taux d'entrée effective   : billets scannés à l'entrée / billets vendus. Son complément
//                                 est le no-show, l'indicateur de référence pour dimensionner
//                                 une salle et négocier avec les prestataires
//   - Taux d'abandon panier     : commandes engagées jamais payées (annulées par le cron)
//
// Les montants ne comptent que les billets réellement encaissés (cf. src/lib/ticketPayment.ts).
// Le taux d'abandon est le seul indicateur à regarder aussi les billets non payés — c'est
// précisément son objet.

interface OrganizerReportsProps {
  stats: SalesStatus | null;
  events: Event[];
  loading?: boolean;
}

type Granularity = "day" | "week" | "month";

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "30 derniers jours",
  week: "12 dernières semaines",
  month: "12 derniers mois",
};

const BUCKET_COUNT: Record<Granularity, number> = { day: 30, week: 12, month: 12 };

// Forme "emphase" : une teinte d'accent pour ce que l'organisateur touche, un gris de recul
// pour la commission — qui est du contexte, pas le sujet. Couple validé pour la séparation
// sous déficience de la vision des couleurs et le contraste sur fond blanc.
const NET_COLOR = "#ea580c";
const COMMISSION_COLOR = "#64748b";

interface Bucket {
  key: string;
  label: string;
  fullLabel: string;
  // Premier jour d'un mois : sert à ancrer l'axe journalier, dont les étiquettes ne portent
  // sinon que le quantième (…30, 31, 1, 2… sans dire qu'on a changé de mois).
  isMonthStart: boolean;
  gross: number;
}

function startOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Lundi comme premier jour de la semaine (usage francophone), contrairement au dimanche
// renvoyé par getDay() === 0.
function startOfWeek(value: Date): Date {
  const copy = startOfDay(value);
  const weekday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - weekday);
  return copy;
}

function startOfMonth(value: Date): Date {
  const copy = startOfDay(value);
  copy.setDate(1);
  return copy;
}

function bucketStart(value: Date, granularity: Granularity): Date {
  if (granularity === "week") return startOfWeek(value);
  if (granularity === "month") return startOfMonth(value);
  return startOfDay(value);
}

function shiftBuckets(value: Date, granularity: Granularity, amount: number): Date {
  const copy = new Date(value);
  if (granularity === "week") copy.setDate(copy.getDate() - amount * 7);
  else if (granularity === "month") copy.setMonth(copy.getMonth() - amount);
  else copy.setDate(copy.getDate() - amount);
  return copy;
}

function bucketLabels(date: Date, granularity: Granularity): { label: string; fullLabel: string } {
  if (granularity === "month") {
    return {
      label: date.toLocaleDateString("fr-FR", { month: "short" }),
      fullLabel: date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    };
  }
  if (granularity === "week") {
    return {
      label: date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
      fullLabel: `Semaine du ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`,
    };
  }
  return {
    // Le 1er du mois porte son mois, pour que la suite "…30, 31, 1, 2" reste lisible.
    label: date.getDate() === 1
      ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
      : date.toLocaleDateString("fr-FR", { day: "numeric" }),
    fullLabel: date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
  };
}

function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export default function OrganizerReports({ stats, events, loading = false }: OrganizerReportsProps) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [tableVisible, setTableVisible] = useState(false);

  const allTickets = useMemo(() => stats?.tickets || [], [stats]);
  const paidTickets = useMemo(() => allTickets.filter(isPaidTicket), [allTickets]);

  // Taux de commission effectif déjà calculé côté serveur : il peut mélanger plusieurs
  // événements à taux négociés différents. Approximation assumée pour ventiler le net par
  // période, cohérente avec les relevés mensuels de l'onglet Factures qui font de même.
  const commissionRate = stats?.commissionRate ?? 0;

  const buckets = useMemo<Bucket[]>(() => {
    const now = new Date();
    const current = bucketStart(now, granularity);
    const list: Bucket[] = [];
    const byKey = new Map<string, Bucket>();

    for (let offset = BUCKET_COUNT[granularity] - 1; offset >= 0; offset--) {
      const date = bucketStart(shiftBuckets(current, granularity, offset), granularity);
      const { label, fullLabel } = bucketLabels(date, granularity);
      const bucket: Bucket = { key: date.toISOString(), label, fullLabel, isMonthStart: date.getDate() === 1, gross: 0 };
      list.push(bucket);
      byKey.set(bucket.key, bucket);
    }

    for (const ticket of paidTickets) {
      const purchased = new Date(ticket.purchaseDate);
      if (isNaN(purchased.getTime())) continue;
      const bucket = byKey.get(bucketStart(purchased, granularity).toISOString());
      if (bucket) bucket.gross += Number(ticket.pricePaid) || 0;
    }

    return list;
  }, [paidTickets, granularity]);

  const periodGross = buckets.reduce((sum, b) => sum + b.gross, 0);
  const periodCommission = Math.floor(periodGross * commissionRate);
  const peak = Math.max(...buckets.map((b) => b.gross), 0);
  const axisMax = niceCeiling(peak);

  // --- Indicateurs sectoriels ---
  const indicators = useMemo(() => {
    const ticketsSold = paidTickets.reduce((sum, t) => sum + (Number(t.quantity) || 1), 0);
    const gross = paidTickets.reduce((sum, t) => sum + (Number(t.pricePaid) || 0), 0);
    const averagePrice = ticketsSold > 0 ? Math.round(gross / ticketsSold) : 0;

    const capacity = events.reduce((sum, e) => sum + (Number(e.totalTickets) || 0), 0);
    const fillRate = capacity > 0 ? Math.min(1, ticketsSold / capacity) : null;

    // Le taux d'entrée ne se mesure que sur les événements déjà commencés : un billet non
    // scanné pour un concert de le mois prochain n'est pas un absent, juste un futur entrant.
    const startedEventIds = new Set(events.filter(isEventPast).map((e) => e.id));
    const scannableTickets = paidTickets.filter((t) => startedEventIds.has(t.eventId));
    const scannedCount = scannableTickets.filter((t) => t.scanned).length;
    const scanRate = scannableTickets.length > 0 ? scannedCount / scannableTickets.length : null;

    // Seul indicateur à compter les billets NON payés : c'est son objet même.
    const abandoned = allTickets.length - paidTickets.length;
    const abandonRate = allTickets.length > 0 ? abandoned / allTickets.length : null;

    return {
      ticketsSold, gross, averagePrice, capacity, fillRate,
      scanRate, scannedCount, scannableCount: scannableTickets.length,
      abandoned, abandonRate,
    };
  }, [paidTickets, allTickets, events]);

  // --- Répartition du chiffre d'affaires par catégorie de billet ---
  const tierBreakdown = useMemo(() => {
    const byTier = new Map<string, { gross: number; count: number }>();
    for (const t of paidTickets) {
      const key = t.tier || "standard";
      const entry = byTier.get(key) || { gross: 0, count: 0 };
      entry.gross += Number(t.pricePaid) || 0;
      entry.count += Number(t.quantity) || 1;
      byTier.set(key, entry);
    }
    const rows = Array.from(byTier.entries())
      .map(([tier, v]) => ({ tier: formatTierLabel(tier), ...v }))
      .sort((a, b) => b.gross - a.gross);

    // Au-delà de 7 classes les nuances adjacentes se confondent : le reliquat est replié
    // dans "Autres" plutôt que d'allonger indéfiniment la liste.
    if (rows.length <= 7) return rows;
    const head = rows.slice(0, 6);
    const tail = rows.slice(6);
    head.push({
      tier: "Autres",
      gross: tail.reduce((s, r) => s + r.gross, 0),
      count: tail.reduce((s, r) => s + r.count, 0),
    });
    return head;
  }, [paidTickets]);

  const tierMax = Math.max(...tierBreakdown.map((r) => r.gross), 0);

  // --- Performance par événement ---
  const eventRows = useMemo(() => {
    return events
      .map((evt) => {
        const evtTickets = paidTickets.filter((t) => t.eventId === evt.id);
        const sold = evtTickets.reduce((sum, t) => sum + (Number(t.quantity) || 1), 0);
        const gross = evtTickets.reduce((sum, t) => sum + (Number(t.pricePaid) || 0), 0);
        const rate = evt.commissionRate ?? commissionRate;
        const started = isEventPast(evt);
        const scanned = evtTickets.filter((t) => t.scanned).length;
        return {
          id: evt.id,
          title: evt.title,
          date: evt.date,
          capacity: Number(evt.totalTickets) || 0,
          sold,
          gross,
          net: gross - Math.floor(gross * rate),
          fillRate: Number(evt.totalTickets) > 0 ? Math.min(1, sold / Number(evt.totalTickets)) : null,
          scanRate: started && evtTickets.length > 0 ? scanned / evtTickets.length : null,
          started,
        };
      })
      .sort((a, b) => b.gross - a.gross);
  }, [events, paidTickets, commissionRate]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-gray-100 bg-white text-xs font-semibold text-gray-400">
        Chargement du rapport...
      </div>
    );
  }

  return (
    <div className="space-y-6" id="orga-reports-view">
      {/* Indicateurs clés */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <StatTile
          icon={<Wallet className="h-5 w-5" />}
          tone="orange"
          label="Chiffre d'affaires brut"
          value={`${indicators.gross.toLocaleString("fr-FR")} F`}
          hint={`Net encaissé : ${(indicators.gross - Math.floor(indicators.gross * commissionRate)).toLocaleString("fr-FR")} F`}
        />
        <StatTile
          icon={<TicketIcon className="h-5 w-5" />}
          tone="slate"
          label="Billets vendus"
          value={indicators.ticketsSold.toLocaleString("fr-FR")}
          hint={indicators.capacity > 0 ? `Jauge totale : ${indicators.capacity.toLocaleString("fr-FR")}` : undefined}
        />
        <StatTile
          icon={<TrendingUp className="h-5 w-5" />}
          tone="slate"
          label="Prix moyen du billet"
          value={`${indicators.averagePrice.toLocaleString("fr-FR")} F`}
          hint="Mix tarifaire réellement vendu"
        />
        <StatTile
          icon={<Users className="h-5 w-5" />}
          tone="slate"
          label="Taux de remplissage"
          value={indicators.fillRate === null ? "—" : formatPercent(indicators.fillRate)}
          hint={indicators.fillRate === null ? "Aucune jauge définie" : "Billets vendus / jauge"}
        />
        <StatTile
          icon={<ScanLine className="h-5 w-5" />}
          tone="slate"
          label="Entrées effectives"
          value={indicators.scanRate === null ? "—" : formatPercent(indicators.scanRate)}
          hint={
            indicators.scanRate === null
              ? "Aucun événement encore commencé"
              : `${indicators.scannedCount} scannés / ${indicators.scannableCount} · no-show ${formatPercent(1 - indicators.scanRate)}`
          }
        />
        <StatTile
          icon={<ShoppingCart className="h-5 w-5" />}
          tone="slate"
          label="Abandon de panier"
          value={indicators.abandonRate === null ? "—" : formatPercent(indicators.abandonRate)}
          hint={indicators.abandonRate === null ? "Aucune commande" : `${indicators.abandoned} commande(s) jamais payée(s)`}
        />
      </div>

      {/* Chiffre d'affaires : net encaissé + commission = brut */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-50 pb-4">
          <div>
            <h4 className="text-sm font-black text-gray-900">Chiffre d'affaires et net encaissé</h4>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Ce que vous touchez, commission plateforme déduite
            </p>
          </div>
          {/* Filtres sur une seule ligne au-dessus du graphique */}
          <div className="flex gap-1 rounded-xl bg-gray-50 p-1">
            {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`rounded-lg px-3 py-1.5 text-[10px] font-black transition-all ${
                  granularity === g ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {GRANULARITY_LABELS[g]}
              </button>
            ))}
          </div>
        </div>

        {/* Légende : obligatoire dès deux séries, l'identité ne repose jamais sur la seule couleur */}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <LegendKey color={NET_COLOR} label="Net encaissé" />
          <LegendKey color={COMMISSION_COLOR} label={`Commission plateforme (${Math.round(commissionRate * 100)} %)`} />
          <span className="ml-auto text-[11px] font-bold text-gray-500">
            Brut sur la période :{" "}
            <span className="font-extrabold text-gray-900">{periodGross.toLocaleString("fr-FR")} F</span>
            <span className="font-semibold text-gray-400"> · net {(periodGross - periodCommission).toLocaleString("fr-FR")} F</span>
          </span>
        </div>

        {periodGross === 0 ? (
          <div className="mt-4 flex h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-100 text-center">
            <TrendingUp className="h-8 w-8 text-gray-300" />
            <p className="mt-3 text-xs font-bold text-gray-900">Aucune vente sur cette période</p>
            <p className="mt-1 text-[11px] text-gray-500">Changez de période ou attendez vos premières ventes confirmées.</p>
          </div>
        ) : (
          <>
            {/* Marge haute réservée hors zone de tracé pour l'infobulle (cf. WeeklySalesChart) */}
            <div className="mt-2 pt-10">
              <div className="relative h-52 pl-16">
                {[0, 0.5, 1].map((ratio) => (
                  <div key={ratio} className="absolute right-0 left-16 flex items-center" style={{ bottom: `${ratio * 100}%` }}>
                    <span className="absolute -left-16 w-14 text-right font-mono text-[9px] tabular-nums text-gray-400">
                      {(axisMax * ratio).toLocaleString("fr-FR")}
                    </span>
                    <div className="h-px w-full bg-gray-100" />
                  </div>
                ))}

                <div className="flex h-full items-end gap-0.5">
                  {buckets.map((bucket) => {
                    const commission = Math.floor(bucket.gross * commissionRate);
                    const net = bucket.gross - commission;
                    const totalPct = axisMax > 0 ? (bucket.gross / axisMax) * 100 : 0;
                    const netPct = bucket.gross > 0 ? (net / bucket.gross) * 100 : 0;
                    return (
                      <div
                        key={bucket.key}
                        className="group relative flex h-full flex-1 flex-col justify-end outline-none"
                        tabIndex={0}
                        role="img"
                        aria-label={`${bucket.fullLabel} : brut ${bucket.gross.toLocaleString("fr-FR")} francs CFA, dont net ${net.toLocaleString("fr-FR")} et commission ${commission.toLocaleString("fr-FR")}`}
                      >
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 mb-1.5 hidden justify-center group-hover:flex group-focus-visible:flex"
                          style={{ bottom: `${totalPct}%` }}
                        >
                          <span className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-left whitespace-nowrap shadow-md">
                            <span className="block text-[11px] font-extrabold text-white">
                              {bucket.gross.toLocaleString("fr-FR")} F brut
                            </span>
                            <span className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold text-gray-200">
                              <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ backgroundColor: NET_COLOR }} />
                              net {net.toLocaleString("fr-FR")} F
                            </span>
                            <span className="flex items-center gap-1 text-[9px] font-semibold text-gray-200">
                              <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ backgroundColor: COMMISSION_COLOR }} />
                              commission {commission.toLocaleString("fr-FR")} F
                            </span>
                            <span className="mt-0.5 block text-[9px] font-semibold text-gray-400">{bucket.fullLabel}</span>
                          </span>
                        </div>

                        {/* Empilement net + commission = brut. Le blanc entre les deux segments
                            fait la séparation (2px), jamais un contour dessiné autour. */}
                        <div className="mx-auto flex w-full max-w-6 flex-col" style={{ height: `${totalPct}%` }}>
                          <div
                            className="w-full shrink-0 rounded-t"
                            style={{ height: `${100 - netPct}%`, backgroundColor: COMMISSION_COLOR }}
                          />
                          <div className="h-0.5 w-full shrink-0 bg-white" />
                          <div className="w-full flex-1" style={{ backgroundColor: NET_COLOR }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3 flex gap-0.5 pl-16">
              {buckets.map((bucket, i) => (
                <span key={bucket.key} className="flex-1 text-center font-mono text-[9px] text-gray-400">
                  {/* En vue journalière, une étiquette sur deux : 30 nombres collés deviennent
                      illisibles et se chevauchent sur les écrans étroits. Le 1er du mois est
                      toujours affiché, même s'il tombe sur un rang masqué : c'est lui qui
                      ancre l'axe. */}
                  {granularity === "day" && i % 2 !== 0 && !bucket.isMonthStart ? "" : bucket.label}
                </span>
              ))}
            </div>

            <button
              onClick={() => setTableVisible((v) => !v)}
              className="mt-4 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-gray-400 transition-colors hover:text-orange-600"
            >
              <Table2 className="h-3 w-3" />
              {tableVisible ? "Masquer les valeurs" : "Voir les valeurs"}
            </button>

            {tableVisible && (
              <div className="mt-3 max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-gray-100 text-[9px] font-extrabold uppercase tracking-wider text-gray-400">
                      <th className="pb-2">Période</th>
                      <th className="pb-2 text-right">Brut</th>
                      <th className="pb-2 text-right">Net</th>
                      <th className="pb-2 text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {buckets.map((bucket) => {
                      const commission = Math.floor(bucket.gross * commissionRate);
                      return (
                        <tr key={bucket.key}>
                          <td className="py-1.5 font-semibold text-gray-600 first-letter:uppercase">{bucket.fullLabel}</td>
                          <td className="py-1.5 text-right font-mono font-bold tabular-nums text-gray-900">
                            {bucket.gross.toLocaleString("fr-FR")}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums text-gray-600">
                            {(bucket.gross - commission).toLocaleString("fr-FR")}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums text-gray-400">
                            {commission.toLocaleString("fr-FR")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Répartition par catégorie de billet */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        <h4 className="text-sm font-black text-gray-900">Répartition par catégorie de billet</h4>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Chiffre d'affaires brut par tarif
        </p>

        {tierBreakdown.length === 0 ? (
          <p className="py-10 text-center text-xs font-semibold text-gray-400">Aucune vente confirmée à ce jour.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {tierBreakdown.map((row) => (
              <div key={row.tier}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-bold text-gray-800">{row.tier}</span>
                  <span className="font-mono text-[11px] font-bold tabular-nums text-gray-900">
                    {row.gross.toLocaleString("fr-FR")} F
                    <span className="ml-2 font-sans text-[10px] font-semibold text-gray-400">
                      {row.count} billet{row.count > 1 ? "s" : ""}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full rounded-full bg-gray-50">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${tierMax > 0 ? (row.gross / tierMax) * 100 : 0}%`, backgroundColor: NET_COLOR }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Performance par événement : plusieurs mesures par ligne, un tableau les sert mieux
          qu'un graphique — c'est de la lecture ligne à ligne, pas une comparaison de formes. */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        <h4 className="text-sm font-black text-gray-900">Performance par événement</h4>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Remplissage et entrées effectives
        </p>

        {eventRows.length === 0 ? (
          <p className="py-10 text-center text-xs font-semibold text-gray-400">Aucun événement à ce jour.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-extrabold uppercase tracking-wider text-gray-400">
                  <th className="pb-2">Événement</th>
                  <th className="pb-2 text-right">Vendus / Jauge</th>
                  <th className="pb-2 text-right">Remplissage</th>
                  <th className="pb-2 text-right">Brut</th>
                  <th className="pb-2 text-right">Net</th>
                  <th className="pb-2 text-right">Entrées</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {eventRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="py-2 pr-3">
                      <p className="font-bold text-gray-900">{row.title}</p>
                      <p className="font-mono text-[9px] text-gray-400">{row.date}</p>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-gray-600">
                      {row.sold} / {row.capacity || "—"}
                    </td>
                    <td className="py-2 text-right font-mono font-bold tabular-nums text-gray-900">
                      {row.fillRate === null ? "—" : formatPercent(row.fillRate)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-gray-600">
                      {row.gross.toLocaleString("fr-FR")}
                    </td>
                    <td className="py-2 text-right font-mono font-bold tabular-nums text-orange-600">
                      {row.net.toLocaleString("fr-FR")}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-gray-600">
                      {row.scanRate === null ? (
                        <span className="text-[10px] font-sans font-semibold text-gray-300">à venir</span>
                      ) : (
                        formatPercent(row.scanRate)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Tuile d'indicateur : libellé, valeur, et une précision facultative. La valeur porte des
// chiffres proportionnels (pas tabulaires) : à cette taille, des chasses égales font
// "flotter" le nombre.
function StatTile({ icon, label, value, hint, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone: "orange" | "slate";
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex items-center gap-2.5">
        <span className={`rounded-lg p-2 ${tone === "orange" ? "bg-orange-50 text-orange-600" : "bg-gray-50 text-gray-500"}`}>
          {icon}
        </span>
        <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <p className="mt-2.5 text-xl font-extrabold text-gray-950">{value}</p>
      {hint && <p className="mt-1 text-[10px] font-semibold text-gray-400">{hint}</p>}
    </div>
  );
}

// Clé de légende : un aplat pour une série dessinée en aplat (barres empilées), jamais du
// texte coloré — l'identité vient de la pastille à côté du libellé.
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-[11px] font-bold text-gray-600">{label}</span>
    </span>
  );
}
