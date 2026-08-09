import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./config.js";
import { isPaidTicket } from "./ticketPayment.js";

export const DEFAULT_TICKET_COMMISSION_RATE = 0.06;

// Taux de commission plateforme par défaut, lu depuis platform_config (voir supabase_setup.sql
// section 11). Un événement peut le surcharger individuellement via events.commission_rate.
export async function getDefaultCommissionRate(configKey: "ticket_commission_rate" = "ticket_commission_rate"): Promise<number> {
  const fallback = DEFAULT_TICKET_COMMISSION_RATE;
  if (!supabase) return fallback;
  try {
    const { data, error } = await supabase
      .from("platform_config")
      .select("value")
      .eq("key", configKey)
      .maybeSingle();
    if (error || !data) return fallback;
    const parsed = Number(data.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Calcule la commission plateforme événement par événement (chacun applique son propre
// taux négocié s'il en a un, sinon le taux par défaut) avant de sommer : impossible
// d'appliquer un taux unique sur le total agrégé dès qu'un événement a un taux différent.
//
// Seuls les billets réellement encaissés (PAID-/FREE-) entrent dans le calcul. Les billets
// en attente de paiement, expirés par le cron ou refusés étaient auparavant comptés comme du
// chiffre d'affaires : un panier abandonné gonflait donc le solde de l'organisateur — et le
// contrôle de solde autorisant ses retraits (cf. getOrganizerAvailableBalance) — d'un montant
// jamais encaissé, jusqu'à la purge de rétention. Le filtre est appliqué ici plutôt qu'à
// chaque appelant : les six sites d'appel veulent tous la même définition, et un oubli à l'un
// d'eux se traduirait directement en argent.
export function computeCommissionBreakdown(
  tickets: any[],
  eventCommissionRateById: Map<string, number | null | undefined>,
  defaultRate: number
): { totalGrossRevenue: number; totalCommission: number; totalRevenue: number; effectiveCommissionRate: number } {
  const grossByEvent = new Map<string, number>();
  for (const t of tickets) {
    if (!isPaidTicket(t)) continue;
    const eventId = t.event_id ?? t.eventId;
    const price = Number(t.price_paid ?? t.pricePaid ?? 0);
    grossByEvent.set(eventId, (grossByEvent.get(eventId) || 0) + price);
  }

  let totalGrossRevenue = 0;
  let totalCommission = 0;
  for (const [eventId, gross] of grossByEvent) {
    const rate = eventCommissionRateById.get(eventId) ?? defaultRate;
    totalGrossRevenue += gross;
    totalCommission += Math.floor(gross * rate);
  }

  return {
    totalGrossRevenue,
    totalCommission,
    totalRevenue: totalGrossRevenue - totalCommission,
    effectiveCommissionRate: totalGrossRevenue > 0 ? totalCommission / totalGrossRevenue : defaultRate
  };
}


// Plafond explicite des listes renvoyées aux tableaux de bord.
//
// L'API REST de Supabase en impose déjà un, invisible, de 1 000 lignes. Le poser ici le rend
// VOLONTAIRE et documenté : ces listes servent à afficher des tableaux et l'activité récente,
// jamais à calculer un total. Les totaux passent par ticket_revenue_stats ci-dessous, qui
// agrège en base et qu'aucun plafond ne concerne.
export const MAX_LIST_ROWS = 500;

export interface RevenueAggregates {
  totalRevenue: number;
  totalPlatformCommission: number;
  commissionRate: number;
  totalTicketsSold: number;
}

// Totaux calculés par Postgres (fonction ticket_revenue_stats, supabase_setup.sql section 21).
// Renvoie null si la fonction n'existe pas encore — la migration peut ne pas avoir été jouée —
// afin que l'appelant retombe sur le calcul en mémoire plutôt que d'afficher zéro. Ce repli
// reste soumis au plafond de 1 000 lignes : il dépanne, il ne remplace pas la migration.
export async function fetchRevenueAggregates(
  client: SupabaseClient,
  organizerId: string | null
): Promise<RevenueAggregates | null> {
  try {
    const { data, error } = await client.rpc("ticket_revenue_stats", { p_organizer_id: organizerId });
    if (error || !data) {
      if (error) {
        console.warn(
          `[Stats] ticket_revenue_stats indisponible (${error.message}) : repli sur le calcul en mémoire, ` +
          `plafonné à 1 000 billets par l'API Supabase. Jouez la section 21 de supabase_setup.sql.`
        );
      }
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      totalRevenue: Number(row.total_gross_revenue) || 0,
      totalPlatformCommission: Number(row.total_commission) || 0,
      commissionRate: Number(row.effective_commission_rate) || DEFAULT_TICKET_COMMISSION_RATE,
      totalTicketsSold: Number(row.total_tickets_sold) || 0,
    };
  } catch (err: any) {
    console.warn("[Stats] Échec de ticket_revenue_stats :", err?.message);
    return null;
  }
}

// Indicateurs des onglets Rapports, agrégés en base (fonction ticket_report_stats,
// supabase_setup.sql section 22) : taux de remplissage, taux d'entrée, taux d'abandon,
// répartition par tarif, performance par événement et série temporelle.
//
// Renvoie null si la migration n'a pas été jouée : les écrans retombent alors sur leur
// calcul local, à partir de la liste bornée qu'ils reçoivent déjà.
export async function fetchReportStats(
  client: SupabaseClient,
  organizerId: string | null
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await client.rpc("ticket_report_stats", { p_organizer_id: organizerId });
    if (error || !data) {
      if (error) console.warn(`[Rapports] ticket_report_stats indisponible (${error.message}) : calcul local conservé.`);
      return null;
    }
    return data as Record<string, any>;
  } catch (err: any) {
    console.warn("[Rapports] Échec de ticket_report_stats :", err?.message);
    return null;
  }
}
