import { useMemo, useState } from "react";
import { TrendingUp, Users, Ticket as TicketIcon, ScanLine, Wallet, ShoppingCart } from "lucide-react";
import { Event, SalesStatus } from "../types";
import { isPaidTicket } from "../lib/ticketPayment";
import { formatTierLabel } from "../lib/ticketTier";
import { hasEventStarted } from "../lib/eventStatus";
import { Granularity, buildTimeBuckets, bucketStart, formatPercent } from "../lib/chartBuckets";
import StackedRevenueChart, { RevenueBucket, ACCENT_COLOR } from "./StackedRevenueChart";

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

export default function OrganizerReports({ stats, events, loading = false }: OrganizerReportsProps) {
  const [granularity, setGranularity] = useState<Granularity>("day");

  const allTickets = useMemo(() => stats?.tickets || [], [stats]);
  const paidTickets = useMemo(() => allTickets.filter(isPaidTicket), [allTickets]);

  // Taux de commission effectif déjà calculé côté serveur : il peut mélanger plusieurs
  // événements à taux négociés différents. Approximation assumée pour ventiler le net par
  // période, cohérente avec les relevés mensuels de l'onglet Factures qui font de même.
  const commissionRate = stats?.commissionRate ?? 0;

  // Le net par période applique le taux effectif global : la ventilation est donc approchée
  // si plusieurs événements ont des taux négociés différents, le total restant juste.
  const buckets = useMemo<RevenueBucket[]>(() => {
    const list = buildTimeBuckets(granularity).map((b) => ({ ...b, total: 0, primary: 0 }));
    const byKey = new Map(list.map((b) => [b.key, b]));

    for (const ticket of paidTickets) {
      const purchased = new Date(ticket.purchaseDate);
      if (isNaN(purchased.getTime())) continue;
      const bucket = byKey.get(bucketStart(purchased, granularity).toISOString());
      if (bucket) bucket.total += Number(ticket.pricePaid) || 0;
    }

    for (const bucket of list) bucket.primary = bucket.total - Math.floor(bucket.total * commissionRate);
    return list;
  }, [paidTickets, granularity, commissionRate]);

  // --- Indicateurs sectoriels ---
  const indicators = useMemo(() => {
    const ticketsSold = paidTickets.reduce((sum, t) => sum + (Number(t.quantity) || 1), 0);
    const gross = paidTickets.reduce((sum, t) => sum + (Number(t.pricePaid) || 0), 0);
    const averagePrice = ticketsSold > 0 ? Math.round(gross / ticketsSold) : 0;

    const capacity = events.reduce((sum, e) => sum + (Number(e.totalTickets) || 0), 0);
    const fillRate = capacity > 0 ? Math.min(1, ticketsSold / capacity) : null;

    // Le taux d'entrée ne se mesure que sur les événements déjà commencés : un billet non
    // scanné pour un concert de le mois prochain n'est pas un absent, juste un futur entrant.
    const startedEventIds = new Set(events.filter(hasEventStarted).map((e) => e.id));
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
        const started = hasEventStarted(evt);
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

      <StackedRevenueChart
        title="Chiffre d'affaires et net encaissé"
        subtitle="Ce que vous touchez, commission plateforme déduite"
        granularity={granularity}
        onGranularityChange={setGranularity}
        buckets={buckets}
        primaryLabel="Net encaissé"
        secondaryLabel={`Commission plateforme (${Math.round(commissionRate * 100)} %)`}
        emptyMessage="Changez de période ou attendez vos premières ventes confirmées."
      />

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
                    style={{ width: `${tierMax > 0 ? (row.gross / tierMax) * 100 : 0}%`, backgroundColor: ACCENT_COLOR }}
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
