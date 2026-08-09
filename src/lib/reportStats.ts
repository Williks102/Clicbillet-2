import { Granularity, buildTimeBuckets, bucketStart } from "./chartBuckets";
import type { RevenueBucket } from "../components/StackedRevenueChart";

// Indicateurs de rapport agrégés par la base (fonction ticket_report_stats, supabase_setup.sql
// section 22) et renvoyés tels quels par /api/admin/stats et /api/organizer/stats.
//
// Les écrans les calculaient jusqu'ici eux-mêmes, en parcourant la liste de billets reçue. Cette
// liste est bornée — elle l'était même à leur insu, l'API REST de Supabase plafonnant à
// 1 000 lignes : au-delà, tous les taux affichés portaient sur un échantillon sans que rien ne
// l'indique. Les listes servent donc encore à afficher (activité récente, tableaux), jamais à
// totaliser.
export interface ServerReport {
  ticketsSold: number;
  gross: number;
  commission: number;
  capacity: number;
  scannableCount: number;
  scannedCount: number;
  totalTicketRows: number;
  paidTicketRows: number;
  tiers: { tier: string; gross: number; count: number }[];
  events: {
    id: string;
    title: string;
    date: string;
    capacity: number;
    started: boolean;
    gross: number;
    commission: number;
    sold: number;
    paid_rows: number;
    scanned: number;
  }[];
  series: { jour: string; gross: number; commission: number }[];
}

// Les nombres traversent le JSON en chaînes quand PostgreSQL les renvoie en NUMERIC : on
// normalise à l'entrée plutôt que de parsemer le rendu de Number().
const n = (value: unknown): number => Number(value) || 0;

export function normalizeReport(raw: any): ServerReport | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    ticketsSold: n(raw.ticketsSold),
    gross: n(raw.gross),
    commission: n(raw.commission),
    capacity: n(raw.capacity),
    scannableCount: n(raw.scannableCount),
    scannedCount: n(raw.scannedCount),
    totalTicketRows: n(raw.totalTicketRows),
    paidTicketRows: n(raw.paidTicketRows),
    tiers: (raw.tiers || []).map((t: any) => ({ tier: String(t.tier ?? "standard"), gross: n(t.gross), count: n(t.count) })),
    events: (raw.events || []).map((e: any) => ({
      id: String(e.id),
      title: String(e.title ?? ""),
      date: String(e.date ?? ""),
      capacity: n(e.capacity),
      started: Boolean(e.started),
      gross: n(e.gross),
      commission: n(e.commission),
      sold: n(e.sold),
      paid_rows: n(e.paid_rows),
      scanned: n(e.scanned),
    })),
    series: (raw.series || []).map((s: any) => ({ jour: String(s.jour), gross: n(s.gross), commission: n(s.commission) })),
  };
}

// Répartit la série quotidienne renvoyée par la base dans les intervalles de l'axe choisi.
// Le jour étant la granularité la plus fine proposée par les écrans, regrouper en semaines ou
// en mois reste exact — on ne perd rien en repliant vers le haut.
export function bucketsFromSeries(
  series: ServerReport["series"],
  granularity: Granularity,
  primaryOf: (gross: number, commission: number) => number
): RevenueBucket[] {
  const list = buildTimeBuckets(granularity).map((b) => ({ ...b, total: 0, primary: 0 }));
  const byKey = new Map(list.map((b) => [b.key, b]));
  const commissionByKey = new Map<string, number>();

  for (const row of series) {
    const jour = new Date(row.jour);
    if (isNaN(jour.getTime())) continue;
    const key = bucketStart(jour, granularity).toISOString();
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.total += row.gross;
    commissionByKey.set(key, (commissionByKey.get(key) || 0) + row.commission);
  }

  for (const bucket of list) {
    bucket.primary = primaryOf(bucket.total, commissionByKey.get(bucket.key) || 0);
  }
  return list;
}

// Au-delà de 7 classes les nuances adjacentes se confondent : le reliquat est replié dans
// "Autres" plutôt que d'allonger indéfiniment la liste. Règle reprise à l'identique des deux
// écrans, qui l'appliquaient chacun de leur côté.
export function foldTiers<T extends { gross: number; count: number }>(
  rows: (T & { tier: string })[],
  label: (tier: string) => string
): { tier: string; gross: number; count: number }[] {
  const sorted = [...rows].sort((a, b) => b.gross - a.gross).map((r) => ({ tier: label(r.tier), gross: r.gross, count: r.count }));
  if (sorted.length <= 7) return sorted;
  const head = sorted.slice(0, 6);
  const tail = sorted.slice(6);
  head.push({
    tier: "Autres",
    gross: tail.reduce((s, r) => s + r.gross, 0),
    count: tail.reduce((s, r) => s + r.count, 0),
  });
  return head;
}
