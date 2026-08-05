import { useMemo, useState } from "react";
import { Sparkles, DollarSign, Building2, Ticket as TicketIcon, ScanLine, ShoppingCart } from "lucide-react";
import { Event, Ticket } from "../types";
import { isPaidTicket } from "../lib/ticketPayment";
import { hasEventStarted } from "../lib/eventStatus";
import { Granularity, buildTimeBuckets, bucketStart, formatPercent } from "../lib/chartBuckets";
import StackedRevenueChart, { RevenueBucket, ACCENT_COLOR } from "./StackedRevenueChart";

// Onglet "Rapports" de la supervision : le pendant plateforme du rapport organisateur, avec
// l'accent inversé. Un organisateur regarde ce qu'il touche ; la plateforme regarde ce qu'elle
// prélève. C'est donc la commission ClicBillet qui porte la teinte d'accent ici, et le
// reversement aux organisateurs qui passe en gris de contexte.
//
// Tout est dérivé des données déjà renvoyées par /api/admin/stats — aucun appel supplémentaire.
// Les montants ne comptent que les billets réellement encaissés (cf. src/lib/ticketPayment.ts) ;
// le taux d'abandon est le seul à regarder aussi les billets non payés, c'est son objet.

interface AdminReportsProps {
  events: Event[];
  tickets: Ticket[];
  // Taux effectif calculé côté serveur, utilisé en repli pour un événement sans taux négocié.
  commissionRate: number;
  loading?: boolean;
}

export default function AdminReports({ events, tickets, commissionRate, loading = false }: AdminReportsProps) {
  const [granularity, setGranularity] = useState<Granularity>("day");

  const paidTickets = useMemo(() => tickets.filter(isPaidTicket), [tickets]);

  // Contrairement au rapport organisateur, la supervision dispose du taux négocié de CHAQUE
  // événement : la commission est donc calculée événement par événement, sans approximation.
  const rateByEvent = useMemo(
    () => new Map(events.map((e) => [e.id, e.commissionRate != null ? Number(e.commissionRate) : commissionRate])),
    [events, commissionRate]
  );

  function commissionFor(ticket: Ticket): number {
    const rate = rateByEvent.get(ticket.eventId) ?? commissionRate;
    return Math.floor((Number(ticket.pricePaid) || 0) * rate);
  }

  const buckets = useMemo<RevenueBucket[]>(() => {
    const list = buildTimeBuckets(granularity).map((b) => ({ ...b, total: 0, primary: 0 }));
    const byKey = new Map(list.map((b) => [b.key, b]));

    for (const ticket of paidTickets) {
      const purchased = new Date(ticket.purchaseDate);
      if (isNaN(purchased.getTime())) continue;
      const bucket = byKey.get(bucketStart(purchased, granularity).toISOString());
      if (!bucket) continue;
      bucket.total += Number(ticket.pricePaid) || 0;
      bucket.primary += commissionFor(ticket);
    }

    return list;
  }, [paidTickets, granularity, rateByEvent, commissionRate]);

  const indicators = useMemo(() => {
    const gross = paidTickets.reduce((sum, t) => sum + (Number(t.pricePaid) || 0), 0);
    const commission = paidTickets.reduce((sum, t) => sum + commissionFor(t), 0);
    const ticketsSold = paidTickets.reduce((sum, t) => sum + (Number(t.quantity) || 1), 0);
    const averagePrice = ticketsSold > 0 ? Math.round(gross / ticketsSold) : 0;

    // Un billet non scanné pour un événement à venir n'est pas un absent : le taux d'entrée
    // ne se mesure que sur les événements déjà commencés.
    const startedEventIds = new Set(events.filter(hasEventStarted).map((e) => e.id));
    const scannable = paidTickets.filter((t) => startedEventIds.has(t.eventId));
    const scanned = scannable.filter((t) => t.scanned).length;
    const scanRate = scannable.length > 0 ? scanned / scannable.length : null;

    const abandoned = tickets.length - paidTickets.length;
    const abandonRate = tickets.length > 0 ? abandoned / tickets.length : null;

    // "Actif" au sens commercial : un organisateur ayant réellement vendu, pas simplement
    // inscrit — c'est ce chiffre qui dit si la plateforme tourne.
    const sellingOrganizers = new Set(
      paidTickets.map((t) => events.find((e) => e.id === t.eventId)?.organizerId).filter(Boolean)
    );
    const pendingEvents = events.filter((e) => e.status === "pending").length;

    return {
      gross, commission, payout: gross - commission, ticketsSold, averagePrice,
      scanRate, scanned, scannableCount: scannable.length,
      abandoned, abandonRate, activeOrganizers: sellingOrganizers.size, pendingEvents,
    };
  }, [paidTickets, tickets, events, rateByEvent, commissionRate]);

  // --- Classement des organisateurs par volume d'affaires ---
  const organizerRows = useMemo(() => {
    const byOrganizer = new Map<string, { name: string; gross: number; commission: number; tickets: number; events: Set<string> }>();

    for (const ticket of paidTickets) {
      const evt = events.find((e) => e.id === ticket.eventId);
      if (!evt) continue;
      const entry = byOrganizer.get(evt.organizerId) || {
        name: evt.organizerName || evt.organizerId, gross: 0, commission: 0, tickets: 0, events: new Set<string>(),
      };
      entry.gross += Number(ticket.pricePaid) || 0;
      entry.commission += commissionFor(ticket);
      entry.tickets += Number(ticket.quantity) || 1;
      entry.events.add(evt.id);
      byOrganizer.set(evt.organizerId, entry);
    }

    return Array.from(byOrganizer.entries())
      .map(([id, v]) => ({ id, ...v, eventCount: v.events.size }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 8);
  }, [paidTickets, events, rateByEvent, commissionRate]);

  const organizerMax = Math.max(...organizerRows.map((r) => r.gross), 0);

  // --- Répartition par catégorie d'événement ---
  const categoryRows = useMemo(() => {
    const byCategory = new Map<string, { gross: number; tickets: number }>();
    for (const ticket of paidTickets) {
      const evt = events.find((e) => e.id === ticket.eventId);
      const key = evt?.category || "Non catégorisé";
      const entry = byCategory.get(key) || { gross: 0, tickets: 0 };
      entry.gross += Number(ticket.pricePaid) || 0;
      entry.tickets += Number(ticket.quantity) || 1;
      byCategory.set(key, entry);
    }
    const rows = Array.from(byCategory.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.gross - a.gross);

    // Au-delà de 7 classes, les nuances adjacentes se confondent : le reliquat est replié.
    if (rows.length <= 7) return rows;
    const head = rows.slice(0, 6);
    const tail = rows.slice(6);
    head.push({
      category: "Autres",
      gross: tail.reduce((s, r) => s + r.gross, 0),
      tickets: tail.reduce((s, r) => s + r.tickets, 0),
    });
    return head;
  }, [paidTickets, events]);

  const categoryMax = Math.max(...categoryRows.map((r) => r.gross), 0);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-gray-100 bg-white text-xs font-semibold text-gray-400">
        Chargement du rapport...
      </div>
    );
  }

  return (
    <div className="space-y-6" id="admin-reports-view">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile
          icon={<Sparkles className="h-5 w-5" />}
          tone="orange"
          label="Commission ClicBillet"
          value={`${indicators.commission.toLocaleString("fr-FR")} F`}
          hint="Revenu net de la plateforme"
        />
        <StatTile
          icon={<DollarSign className="h-5 w-5" />}
          label="Volume d'affaires brut"
          value={`${indicators.gross.toLocaleString("fr-FR")} F`}
          hint={`Prix moyen du billet : ${indicators.averagePrice.toLocaleString("fr-FR")} F`}
        />
        <StatTile
          icon={<Building2 className="h-5 w-5" />}
          label="Reversement organisateurs"
          value={`${indicators.payout.toLocaleString("fr-FR")} F`}
          hint={`${indicators.activeOrganizers} organisateur(s) ayant vendu`}
        />
        <StatTile
          icon={<TicketIcon className="h-5 w-5" />}
          label="Billets vendus"
          value={indicators.ticketsSold.toLocaleString("fr-FR")}
          hint={indicators.pendingEvents > 0 ? `${indicators.pendingEvents} événement(s) en attente de modération` : "Aucun événement en attente"}
        />
        <StatTile
          icon={<ScanLine className="h-5 w-5" />}
          label="Entrées effectives"
          value={indicators.scanRate === null ? "—" : formatPercent(indicators.scanRate)}
          hint={
            indicators.scanRate === null
              ? "Aucun événement encore commencé"
              : `${indicators.scanned} scannés / ${indicators.scannableCount} · no-show ${formatPercent(1 - indicators.scanRate)}`
          }
        />
        <StatTile
          icon={<ShoppingCart className="h-5 w-5" />}
          label="Abandon de panier"
          value={indicators.abandonRate === null ? "—" : formatPercent(indicators.abandonRate)}
          hint={indicators.abandonRate === null ? "Aucune commande" : `${indicators.abandoned} commande(s) jamais payée(s)`}
        />
      </div>

      <StackedRevenueChart
        title="Revenus de la plateforme"
        subtitle="Commission prélevée et part reversée aux organisateurs"
        granularity={granularity}
        onGranularityChange={setGranularity}
        buckets={buckets}
        primaryLabel="Commission ClicBillet"
        secondaryLabel="Reversement organisateurs"
        emptyMessage="Changez de période ou attendez les premières ventes confirmées."
        mode="primary-only"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-100 bg-white p-5">
          <h4 className="text-sm font-black text-gray-900">Organisateurs les plus actifs</h4>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Volume d'affaires brut et commission générée
          </p>

          {organizerRows.length === 0 ? (
            <p className="py-10 text-center text-xs font-semibold text-gray-400">Aucune vente confirmée à ce jour.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {organizerRows.map((row) => (
                <div key={row.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-xs font-bold text-gray-800">{row.name}</span>
                    <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-gray-900">
                      {row.gross.toLocaleString("fr-FR")} F
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-gray-50">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${organizerMax > 0 ? (row.gross / organizerMax) * 100 : 0}%`, backgroundColor: ACCENT_COLOR }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] font-semibold text-gray-400">
                    {row.eventCount} événement(s) · {row.tickets} billet(s) · commission {row.commission.toLocaleString("fr-FR")} F
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-5">
          <h4 className="text-sm font-black text-gray-900">Répartition par catégorie d'événement</h4>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Où se fait le volume sur la plateforme
          </p>

          {categoryRows.length === 0 ? (
            <p className="py-10 text-center text-xs font-semibold text-gray-400">Aucune vente confirmée à ce jour.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {categoryRows.map((row) => (
                <div key={row.category}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-xs font-bold text-gray-800">{row.category}</span>
                    <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-gray-900">
                      {row.gross.toLocaleString("fr-FR")} F
                      <span className="ml-2 font-sans text-[10px] font-semibold text-gray-400">
                        {row.tickets} billet{row.tickets > 1 ? "s" : ""}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-gray-50">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${categoryMax > 0 ? (row.gross / categoryMax) * 100 : 0}%`, backgroundColor: ACCENT_COLOR }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, hint, tone = "slate" }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "orange" | "slate";
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
