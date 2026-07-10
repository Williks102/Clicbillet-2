import { supabase } from "./config";

export const DEFAULT_TICKET_COMMISSION_RATE = 0.10;
export const DEFAULT_VOTE_COMMISSION_RATE = 0.15;

// Taux de commission plateforme par défaut, lu depuis platform_config (voir supabase_setup.sql
// section 11). Un événement peut le surcharger individuellement via events.commission_rate ;
// une campagne de vote via voting_campaigns.commission_rate (configKey="vote_commission_rate").
export async function getDefaultCommissionRate(configKey: "ticket_commission_rate" | "vote_commission_rate" = "ticket_commission_rate"): Promise<number> {
  const fallback = configKey === "vote_commission_rate" ? DEFAULT_VOTE_COMMISSION_RATE : DEFAULT_TICKET_COMMISSION_RATE;
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

// Version générique de computeCommissionBreakdown ci-dessous, pour les cas où le montant
// brut par groupe est déjà connu (ex: vote_transactions.amount) plutôt qu'à recalculer à
// partir de lignes prix-unitaire × quantité (cas des tickets).
export function computeCommissionForAmounts(
  amountsByGroupId: Map<string, number>,
  rateById: Map<string, number | null | undefined>,
  defaultRate: number
): { totalGrossRevenue: number; totalCommission: number; totalRevenue: number; effectiveCommissionRate: number } {
  let totalGrossRevenue = 0;
  let totalCommission = 0;
  for (const [groupId, gross] of amountsByGroupId) {
    const rate = rateById.get(groupId) ?? defaultRate;
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

// Calcule la commission plateforme événement par événement (chacun applique son propre
// taux négocié s'il en a un, sinon le taux par défaut) avant de sommer : impossible
// d'appliquer un taux unique sur le total agrégé dès qu'un événement a un taux différent.
export function computeCommissionBreakdown(
  tickets: any[],
  eventCommissionRateById: Map<string, number | null | undefined>,
  defaultRate: number
): { totalGrossRevenue: number; totalCommission: number; totalRevenue: number; effectiveCommissionRate: number } {
  const grossByEvent = new Map<string, number>();
  for (const t of tickets) {
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

