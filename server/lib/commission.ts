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

