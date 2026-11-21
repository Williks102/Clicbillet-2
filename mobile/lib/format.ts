export function formatPrice(xof: number): string {
  if (!xof) return "Gratuit";
  return `${new Intl.NumberFormat("fr-FR").format(xof)} FCFA`;
}

export function formatDate(date: string, time?: string): string {
  const d = new Date(`${date}T${time || "00:00"}`);
  if (isNaN(d.getTime())) return `${date} ${time ?? ""}`.trim();
  const s = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" });
  return time ? `${s} · ${time}` : s;
}
