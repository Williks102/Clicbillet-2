import { useMemo, useState } from "react";
import { TrendingUp, Table2 } from "lucide-react";

// Ventes brutes par jour sur les 7 derniers jours.
//
// Remplace un tracé décoratif codé en dur (une courbe de Bézier fixe + un badge
// "+240%") qui s'affichait à l'identique quel que soit le compte, y compris sur un
// organisateur n'ayant jamais rien vendu.
//
// Le montant retenu est le PRIX BRUT (avant commission plateforme), même définition que
// "Brut total" dans la tuile de solde juste au-dessus : les deux doivent se réconcilier.
interface WeeklySalesChartProps {
  tickets?: { pricePaid: number; purchaseDate: string }[];
  loading?: boolean;
}

interface DayBucket {
  key: string;
  date: Date;
  label: string;
  fullLabel: string;
  amount: number;
}

const DAYS_SHOWN = 7;

function startOfDay(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Arrondit la borne haute de l'axe à une valeur lisible (1000, 2500, 5000...) plutôt que
// de coller au maximum réel, pour que les graduations tombent sur des nombres ronds.
function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function buildBuckets(tickets: WeeklySalesChartProps["tickets"]): DayBucket[] {
  const today = startOfDay(new Date());
  const buckets: DayBucket[] = [];
  const byKey = new Map<string, DayBucket>();

  for (let offset = DAYS_SHOWN - 1; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const bucket: DayBucket = {
      key: date.toDateString(),
      date,
      label: date.toLocaleDateString("fr-FR", { weekday: "short" }),
      fullLabel: date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
      amount: 0,
    };
    buckets.push(bucket);
    byKey.set(bucket.key, bucket);
  }

  for (const ticket of tickets || []) {
    const purchased = new Date(ticket.purchaseDate);
    if (isNaN(purchased.getTime())) continue;
    const bucket = byKey.get(startOfDay(purchased).toDateString());
    if (bucket) bucket.amount += Number(ticket.pricePaid) || 0;
  }

  return buckets;
}

export default function WeeklySalesChart({ tickets, loading = false }: WeeklySalesChartProps) {
  const [tableVisible, setTableVisible] = useState(false);
  const buckets = useMemo(() => buildBuckets(tickets), [tickets]);

  const total = buckets.reduce((sum, b) => sum + b.amount, 0);
  const peak = Math.max(...buckets.map((b) => b.amount));
  const axisMax = niceCeiling(peak);
  // Un seul jour porte une étiquette directe (le meilleur) : une valeur sur chaque colonne
  // devient illisible, l'axe et l'infobulle portent le reste.
  const peakKey = peak > 0 ? buckets.find((b) => b.amount === peak)?.key : null;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-50 pb-4">
        <div>
          <h4 className="flex items-center space-x-1.5 text-sm font-black text-gray-900">
            <TrendingUp className="h-4 w-4 text-orange-600" />
            <span>Ventes des 7 derniers jours</span>
          </h4>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Montant brut encaissé, avant commission
          </p>
        </div>
        <div className="text-right">
          <span className="block text-[10px] font-black uppercase tracking-wider text-gray-400">Total sur la période</span>
          <span className="text-base font-extrabold text-gray-950">
            {loading ? "…" : `${total.toLocaleString("fr-FR")} F`}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-xs font-semibold text-gray-400">
          Chargement des ventes...
        </div>
      ) : total === 0 ? (
        // État vide explicite : mieux vaut dire "aucune vente" que dessiner un graphique
        // vide qu'on pourrait prendre pour un problème d'affichage.
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-100 text-center">
          <TrendingUp className="h-8 w-8 text-gray-300" />
          <p className="mt-3 text-xs font-bold text-gray-900">Aucune vente sur les 7 derniers jours</p>
          <p className="mt-1 text-[11px] text-gray-500">Les ventes apparaîtront ici dès le premier billet payé.</p>
        </div>
      ) : (
        <>
          {/* La marge haute est réservée par ce conteneur extérieur, et non par un padding sur
              la zone de tracé : l'étiquette du pic et l'infobulle se posent au sommet de leur
              barre, et une barre atteignant le haut de l'échelle les enverrait sinon déborder
              sur l'en-tête. Un padding vertical sur la boîte de tracé décalerait en prime les
              graduations (positionnées sur la boîte de padding) par rapport aux barres
              (dimensionnées sur la boîte de contenu). */}
          <div className="mt-4 pt-10">
          <div className="relative h-48 pl-14">
            {/* Graduations : traits pleins d'une nuance au-dessus du fond, volontairement discrets */}
            {[0, 0.5, 1].map((ratio) => (
              <div
                key={ratio}
                className="absolute right-0 left-14 flex items-center"
                style={{ bottom: `${ratio * 100}%` }}
              >
                <span className="absolute -left-14 w-12 text-right font-mono text-[9px] tabular-nums text-gray-400">
                  {(axisMax * ratio).toLocaleString("fr-FR")}
                </span>
                <div className="h-px w-full bg-gray-100" />
              </div>
            ))}

            <div className="flex h-full items-end gap-0.5">
              {buckets.map((bucket) => {
                const heightPct = axisMax > 0 ? (bucket.amount / axisMax) * 100 : 0;
                return (
                  <div
                    key={bucket.key}
                    // La cible de survol couvre toute la colonne, pas seulement la barre
                    // peinte : un jour à zéro reste survolable et annonce bien "0 F".
                    className="group relative flex h-full flex-1 flex-col justify-end outline-none"
                    tabIndex={0}
                    role="img"
                    aria-label={`${bucket.fullLabel} : ${bucket.amount.toLocaleString("fr-FR")} francs CFA`}
                  >
                    {/* Infobulle et étiquette directe sont positionnées en absolu au sommet de
                        la barre (et non dans le flux) : la hauteur de la barre reste exacte, et
                        les deux occupent le même emplacement sans jamais se chevaucher —
                        l'étiquette s'efface au survol, l'infobulle reprenant la même valeur. */}
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 mb-1.5 hidden justify-center group-hover:flex group-focus-visible:flex"
                      style={{ bottom: `${heightPct}%` }}
                    >
                      <span className="rounded-lg bg-gray-900 px-2 py-1 text-center whitespace-nowrap shadow-md">
                        <span className="block text-[11px] font-extrabold text-white">{bucket.amount.toLocaleString("fr-FR")} F</span>
                        <span className="text-[9px] font-semibold text-gray-300">{bucket.fullLabel}</span>
                      </span>
                    </div>

                    {bucket.key === peakKey && (
                      <span
                        className="absolute inset-x-0 mb-1 text-center font-mono text-[9px] font-bold tabular-nums text-gray-500 group-hover:opacity-0 group-focus-visible:opacity-0"
                        style={{ bottom: `${heightPct}%` }}
                      >
                        {bucket.amount.toLocaleString("fr-FR")}
                      </span>
                    )}

                    <div
                      className={`mx-auto w-full max-w-6 rounded-t transition-colors ${
                        bucket.amount > 0
                          ? "bg-orange-600 group-hover:bg-orange-500 group-focus-visible:bg-orange-500"
                          : ""
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          </div>

          <div className="mt-3 flex gap-0.5 pl-14">
            {buckets.map((bucket) => (
              <span key={bucket.key} className="flex-1 text-center font-mono text-[10px] text-gray-400 first-letter:uppercase">
                {bucket.label}
              </span>
            ))}
          </div>

          {/* Les valeurs restent accessibles sans survol (lecteur d'écran, impression,
              pointeur imprécis) : l'infobulle enrichit la lecture, elle ne la conditionne pas. */}
          <button
            onClick={() => setTableVisible((v) => !v)}
            className="mt-4 flex items-center gap-1.5 text-[10px] font-black text-gray-400 uppercase tracking-wider transition-colors hover:text-orange-600"
          >
            <Table2 className="h-3 w-3" />
            {tableVisible ? "Masquer les valeurs" : "Voir les valeurs"}
          </button>

          {tableVisible && (
            <table className="mt-3 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-extrabold uppercase tracking-wider text-gray-400">
                  <th className="pb-2 font-extrabold">Jour</th>
                  <th className="pb-2 text-right font-extrabold">Montant brut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {buckets.map((bucket) => (
                  <tr key={bucket.key}>
                    <td className="py-1.5 font-semibold text-gray-600 first-letter:uppercase">{bucket.fullLabel}</td>
                    <td className="py-1.5 text-right font-mono font-bold tabular-nums text-gray-900">
                      {bucket.amount.toLocaleString("fr-FR")} F
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
