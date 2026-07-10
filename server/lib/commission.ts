import { supabase } from "./config";

export const DEFAULT_TICKET_COMMISSION_RATE = 0.10;

// Taux de commission plateforme par défaut, lu depuis platform_config (voir supabase_setup.sql
// section 11). Un événement peut le surcharger individuellement via events.commission_rate.
export async function getDefaultCommissionRate(): Promise<number> {
  if (!supabase) return DEFAULT_TICKET_COMMISSION_RATE;
  try {
    const { data, error } = await supabase
      .from("platform_config")
      .select("value")
      .eq("key", "ticket_commission_rate")
      .maybeSingle();
    if (error || !data) return DEFAULT_TICKET_COMMISSION_RATE;
    const parsed = Number(data.value);
    return Number.isFinite(parsed) ? parsed : DEFAULT_TICKET_COMMISSION_RATE;
  } catch {
    return DEFAULT_TICKET_COMMISSION_RATE;
  }
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

