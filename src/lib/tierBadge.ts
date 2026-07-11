// Couleur de pastille pour un palier de billet. Les paliers sont désormais libres (définis
// par l'organisateur via event.ticketTypes), donc on ne peut plus coder "vip → ambre, sinon
// bleu" en dur. On garde les conventions historiques (vip = ambre, standard = bleu) et, pour
// tout palier personnalisé, on choisit une couleur stable dérivée du nom : le même nom obtient
// toujours la même pastille, sans avoir à maintenir une liste exhaustive.
const CUSTOM_PALETTE = [
  "bg-purple-100 text-purple-800",
  "bg-teal-100 text-teal-800",
  "bg-rose-100 text-rose-800",
  "bg-indigo-100 text-indigo-800",
  "bg-emerald-100 text-emerald-800",
  "bg-fuchsia-100 text-fuchsia-800",
];

export function tierBadgeClasses(tier: string | null | undefined): string {
  const name = (tier || "").trim().toLowerCase();
  if (name === "vip") return "bg-amber-100 text-amber-800";
  if (name === "standard" || name === "std" || name === "") return "bg-blue-100 text-blue-800";

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CUSTOM_PALETTE[hash % CUSTOM_PALETTE.length];
}
