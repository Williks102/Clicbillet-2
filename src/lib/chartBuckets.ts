// Découpage temporel partagé par les rapports (espace organisateur et supervision admin) :
// mêmes granularités, mêmes libellés, même arrondi d'axe — sans quoi deux écrans censés
// raconter la même histoire la découperaient différemment.

export type Granularity = "day" | "week" | "month";

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "30 derniers jours",
  week: "12 dernières semaines",
  month: "12 derniers mois",
};

export const BUCKET_COUNT: Record<Granularity, number> = { day: 30, week: 12, month: 12 };

export interface TimeBucket {
  key: string;
  label: string;
  fullLabel: string;
  // Premier jour d'un mois : sert à ancrer l'axe journalier, dont les étiquettes ne portent
  // sinon que le quantième (…30, 31, 1, 2… sans dire qu'on a changé de mois).
  isMonthStart: boolean;
}

export function startOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Lundi comme premier jour de la semaine (usage francophone), contrairement au dimanche
// renvoyé par getDay() === 0.
export function startOfWeek(value: Date): Date {
  const copy = startOfDay(value);
  const weekday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - weekday);
  return copy;
}

export function startOfMonth(value: Date): Date {
  const copy = startOfDay(value);
  copy.setDate(1);
  return copy;
}

export function bucketStart(value: Date, granularity: Granularity): Date {
  if (granularity === "week") return startOfWeek(value);
  if (granularity === "month") return startOfMonth(value);
  return startOfDay(value);
}

function shiftBuckets(value: Date, granularity: Granularity, amount: number): Date {
  const copy = new Date(value);
  if (granularity === "week") copy.setDate(copy.getDate() - amount * 7);
  else if (granularity === "month") copy.setMonth(copy.getMonth() - amount);
  else copy.setDate(copy.getDate() - amount);
  return copy;
}

function bucketLabels(date: Date, granularity: Granularity): { label: string; fullLabel: string } {
  if (granularity === "month") {
    return {
      label: date.toLocaleDateString("fr-FR", { month: "short" }),
      fullLabel: date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    };
  }
  if (granularity === "week") {
    return {
      label: date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
      fullLabel: `Semaine du ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`,
    };
  }
  return {
    // Le 1er du mois porte son mois, pour que la suite "…30, 31, 1, 2" reste lisible.
    label: date.getDate() === 1
      ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
      : date.toLocaleDateString("fr-FR", { day: "numeric" }),
    fullLabel: date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
  };
}

// Construit la suite de périodes (la plus ancienne d'abord) jusqu'à aujourd'hui inclus.
// L'appelant y agrège ensuite ses propres montants via bucketStart().
export function buildTimeBuckets(granularity: Granularity): TimeBucket[] {
  const current = bucketStart(new Date(), granularity);
  const buckets: TimeBucket[] = [];

  for (let offset = BUCKET_COUNT[granularity] - 1; offset >= 0; offset--) {
    const date = bucketStart(shiftBuckets(current, granularity, offset), granularity);
    const { label, fullLabel } = bucketLabels(date, granularity);
    buckets.push({ key: date.toISOString(), label, fullLabel, isMonthStart: date.getDate() === 1 });
  }

  return buckets;
}

// Arrondit la borne haute de l'axe à une valeur lisible (1000, 2500, 5000...) plutôt que de
// coller au maximum réel, pour que les graduations tombent sur des nombres ronds.
export function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}
