// Le palier d'un billet (Ticket.tier) est stocké en minuscules (nom du type de billet défini
// par l'organisateur, ex: "standard", "vip", ou tout nom personnalisé comme "pass gp") — cf.
// CheckoutModal.tsx (item.name.toLowerCase()) et server/routes/tickets.ts. Ces fonctions
// dérivent un libellé/style d'affichage cohérent sans supposer qu'il n'existe que deux paliers.

export function isVipTier(tier: string): boolean {
  return tier?.toLowerCase() === "vip";
}

export function formatTierLabel(tier: string): string {
  if (!tier) return "Standard";
  if (isVipTier(tier)) return "VIP";
  return tier.replace(/\b\w/g, (c) => c.toUpperCase());
}
