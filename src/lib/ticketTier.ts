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

// Fenêtre de vente propre à un tarif (salesStart/salesEnd, "YYYY-MM-DDTHH:MM"). Les mêmes
// règles sont appliquées côté serveur dans server/lib/ticketTypes.ts : ici c'est uniquement
// pour l'affichage — le refus qui fait foi vient de /api/checkout.
export type SaleState = "a-venir" | "ouverte" | "close";

export interface SaleWindow {
  salesStart?: string | null;
  salesEnd?: string | null;
}

export function getSaleState(tier: SaleWindow, now: Date = new Date()): SaleState {
  const debut = tier.salesStart ? new Date(tier.salesStart) : null;
  const fin = tier.salesEnd ? new Date(tier.salesEnd) : null;
  if (debut && !isNaN(debut.getTime()) && now < debut) return "a-venir";
  if (fin && !isNaN(fin.getTime()) && now >= fin) return "close";
  return "ouverte";
}

// Reformatage textuel : passer par Date() ne ferait que réintroduire un décalage de fuseau
// dans un libellé que l'organisateur a saisi tel quel.
function formatDateHeure(valeur: string): string {
  const [jour, heure] = valeur.split("T");
  const [a, m, j] = (jour || "").split("-");
  if (!a || !m || !j || !heure) return valeur;
  return `${j}/${m} à ${heure}`;
}

export function formatSaleWindowLabel(tier: SaleWindow, now: Date = new Date()): string | null {
  const etat = getSaleState(tier, now);
  if (etat === "a-venir" && tier.salesStart) return `En vente le ${formatDateHeure(tier.salesStart)}`;
  if (etat === "close") return "Ventes closes";
  // Fenêtre ouverte mais bornée : annoncer la clôture évite de découvrir un tarif disparu.
  if (etat === "ouverte" && tier.salesEnd) return `Jusqu'au ${formatDateHeure(tier.salesEnd)}`;
  return null;
}
