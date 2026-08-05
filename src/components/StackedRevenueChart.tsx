import { useState } from "react";
import { Table2, TrendingUp } from "lucide-react";
import { Granularity, GRANULARITY_LABELS, TimeBucket, niceCeiling } from "../lib/chartBuckets";

// Colonnes empilées "part mise en avant + part de contexte = total", partagées par le rapport
// organisateur (net + commission = brut) et la supervision admin (commission plateforme +
// reversement organisateurs = brut).
//
// Forme "emphase" plutôt que deux séries de même poids : une teinte d'accent pour la part qui
// intéresse le lecteur de cet écran, un gris de recul pour le reste. L'empilement montre
// directement ce qui revient à qui, là où deux courbes obligeraient à faire la soustraction
// de tête. Couple de couleurs validé pour sa séparation sous déficience de la vision des
// couleurs et son contraste sur fond blanc.
export const ACCENT_COLOR = "#ea580c";
export const MUTED_COLOR = "#64748b";

export interface RevenueBucket extends TimeBucket {
  total: number;
  // Part mise en avant (segment bas). Le complément (total - primary) forme le segment haut.
  primary: number;
}

interface StackedRevenueChartProps {
  title: string;
  subtitle: string;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  buckets: RevenueBucket[];
  primaryLabel: string;
  secondaryLabel: string;
  emptyMessage: string;
  // "stacked" quand les deux parts sont du même ordre de grandeur et que leur somme est le
  // sujet. "primary-only" quand la part mise en avant est petite devant le total (une
  // commission de quelques pour cent) : empilée, elle serait écrasée par une échelle réglée
  // sur le total, et sa propre évolution — le vrai sujet — deviendrait invisible. On la trace
  // alors seule, à sa propre échelle, le total restant lisible dans l'infobulle et le tableau.
  mode?: "stacked" | "primary-only";
}

export default function StackedRevenueChart({
  title, subtitle, granularity, onGranularityChange,
  buckets, primaryLabel, secondaryLabel, emptyMessage, mode = "stacked",
}: StackedRevenueChartProps) {
  const [tableVisible, setTableVisible] = useState(false);
  const primaryOnly = mode === "primary-only";

  const periodTotal = buckets.reduce((sum, b) => sum + b.total, 0);
  const periodPrimary = buckets.reduce((sum, b) => sum + b.primary, 0);
  const axisMax = niceCeiling(Math.max(...buckets.map((b) => (primaryOnly ? b.primary : b.total)), 0));

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-50 pb-4">
        <div>
          <h4 className="text-sm font-black text-gray-900">{title}</h4>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{subtitle}</p>
        </div>
        {/* Filtres sur une seule ligne au-dessus du graphique */}
        <div className="flex gap-1 rounded-xl bg-gray-50 p-1">
          {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => onGranularityChange(g)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-black transition-all ${
                granularity === g ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {GRANULARITY_LABELS[g]}
            </button>
          ))}
        </div>
      </div>

      {/* Légende obligatoire dès DEUX séries tracées ; une série unique n'en porte pas, le
          titre la nomme déjà et une boîte à un seul aplat ne ferait que le répéter. */}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {primaryOnly ? (
          <span className="text-[11px] font-bold text-gray-500">
            {primaryLabel} : <span className="font-extrabold text-gray-900">{periodPrimary.toLocaleString("fr-FR")} F</span>
          </span>
        ) : (
          <>
            <LegendKey color={ACCENT_COLOR} label={primaryLabel} />
            <LegendKey color={MUTED_COLOR} label={secondaryLabel} />
          </>
        )}
        <span className="ml-auto text-[11px] font-bold text-gray-500">
          {primaryOnly ? "Volume brut" : "Total"} sur la période :{" "}
          <span className="font-extrabold text-gray-900">{periodTotal.toLocaleString("fr-FR")} F</span>
          {!primaryOnly && <span className="font-semibold text-gray-400"> · dont {periodPrimary.toLocaleString("fr-FR")} F</span>}
        </span>
      </div>

      {periodTotal === 0 ? (
        <div className="mt-4 flex h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-100 text-center">
          <TrendingUp className="h-8 w-8 text-gray-300" />
          <p className="mt-3 text-xs font-bold text-gray-900">Aucune vente sur cette période</p>
          <p className="mt-1 text-[11px] text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <>
          {/* Marge haute réservée par ce conteneur extérieur, et non par un padding sur la zone
              de tracé : l'infobulle se pose au sommet de sa colonne, et une colonne atteignant
              le haut de l'échelle la ferait sinon déborder sur l'en-tête. Un padding vertical
              sur la boîte de tracé décalerait en prime les graduations (positionnées sur la
              boîte de padding) par rapport aux colonnes (dimensionnées sur la boîte de contenu). */}
          <div className="mt-2 pt-10">
            <div className="relative h-52 pl-16">
              {[0, 0.5, 1].map((ratio) => (
                <div key={ratio} className="absolute right-0 left-16 flex items-center" style={{ bottom: `${ratio * 100}%` }}>
                  <span className="absolute -left-16 w-14 text-right font-mono text-[9px] tabular-nums text-gray-400">
                    {(axisMax * ratio).toLocaleString("fr-FR")}
                  </span>
                  <div className="h-px w-full bg-gray-100" />
                </div>
              ))}

              <div className="flex h-full items-end gap-0.5">
                {buckets.map((bucket) => {
                  const secondary = bucket.total - bucket.primary;
                  // Hauteur de la colonne : le total quand on empile, la seule part mise en
                  // avant sinon (l'échelle suit alors ce qui est réellement tracé).
                  const columnValue = primaryOnly ? bucket.primary : bucket.total;
                  const totalPct = axisMax > 0 ? (columnValue / axisMax) * 100 : 0;
                  const primaryPct = bucket.total > 0 ? (bucket.primary / bucket.total) * 100 : 0;
                  return (
                    <div
                      key={bucket.key}
                      // La cible de survol couvre toute la colonne, pas seulement la partie
                      // peinte : une période à zéro reste interrogeable.
                      className="group relative flex h-full flex-1 flex-col justify-end outline-none"
                      tabIndex={0}
                      role="img"
                      aria-label={`${bucket.fullLabel} : ${bucket.primary.toLocaleString("fr-FR")} francs CFA de ${primaryLabel}, ${secondary.toLocaleString("fr-FR")} de ${secondaryLabel}, ${bucket.total.toLocaleString("fr-FR")} au total`}
                    >
                      <div
                        className="pointer-events-none absolute inset-x-0 z-10 mb-1.5 hidden justify-center group-hover:flex group-focus-visible:flex"
                        style={{ bottom: `${totalPct}%` }}
                      >
                        <span className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-left whitespace-nowrap shadow-md">
                          {/* La valeur mène, le libellé suit : le lecteur vise déjà une date,
                              il vient chercher le nombre. */}
                          <span className="block text-[11px] font-extrabold text-white">
                            {primaryOnly
                              ? `${bucket.primary.toLocaleString("fr-FR")} F de ${primaryLabel.toLowerCase()}`
                              : `${bucket.total.toLocaleString("fr-FR")} F au total`}
                          </span>
                          {primaryOnly ? (
                            <span className="mt-0.5 block text-[9px] font-semibold text-gray-200">
                              sur {bucket.total.toLocaleString("fr-FR")} F de volume brut
                            </span>
                          ) : (
                            <>
                              <span className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold text-gray-200">
                                <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ backgroundColor: ACCENT_COLOR }} />
                                {primaryLabel} : {bucket.primary.toLocaleString("fr-FR")} F
                              </span>
                              <span className="flex items-center gap-1 text-[9px] font-semibold text-gray-200">
                                <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ backgroundColor: MUTED_COLOR }} />
                                {secondaryLabel} : {secondary.toLocaleString("fr-FR")} F
                              </span>
                            </>
                          )}
                          <span className="mt-0.5 block text-[9px] font-semibold text-gray-400">{bucket.fullLabel}</span>
                        </span>
                      </div>

                      {/* Le blanc entre les deux segments fait la séparation (2px), jamais un
                          contour dessiné autour des aplats. */}
                      {primaryOnly ? (
                        <div
                          className="mx-auto w-full max-w-6 rounded-t"
                          style={{ height: `${totalPct}%`, backgroundColor: ACCENT_COLOR }}
                        />
                      ) : (
                        <div className="mx-auto flex w-full max-w-6 flex-col" style={{ height: `${totalPct}%` }}>
                          <div className="w-full shrink-0 rounded-t" style={{ height: `${100 - primaryPct}%`, backgroundColor: MUTED_COLOR }} />
                          <div className="h-0.5 w-full shrink-0 bg-white" />
                          <div className="w-full flex-1" style={{ backgroundColor: ACCENT_COLOR }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-3 flex gap-0.5 pl-16">
            {buckets.map((bucket, i) => (
              <span key={bucket.key} className="flex-1 text-center font-mono text-[9px] text-gray-400">
                {/* En vue journalière, une étiquette sur deux : 30 nombres collés deviennent
                    illisibles et se chevauchent sur les écrans étroits. Le 1er du mois est
                    toujours affiché, même s'il tombe sur un rang masqué : c'est lui qui ancre
                    l'axe. */}
                {granularity === "day" && i % 2 !== 0 && !bucket.isMonthStart ? "" : bucket.label}
              </span>
            ))}
          </div>

          {/* Les valeurs restent accessibles sans survol (lecteur d'écran, impression, pointeur
              imprécis) : l'infobulle enrichit la lecture, elle ne la conditionne pas. */}
          <button
            onClick={() => setTableVisible((v) => !v)}
            className="mt-4 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-gray-400 transition-colors hover:text-orange-600"
          >
            <Table2 className="h-3 w-3" />
            {tableVisible ? "Masquer les valeurs" : "Voir les valeurs"}
          </button>

          {tableVisible && (
            <div className="mt-3 max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-100 text-[9px] font-extrabold uppercase tracking-wider text-gray-400">
                    <th className="pb-2">Période</th>
                    <th className="pb-2 text-right">Total</th>
                    <th className="pb-2 text-right">{primaryLabel}</th>
                    <th className="pb-2 text-right">{secondaryLabel}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {buckets.map((bucket) => (
                    <tr key={bucket.key}>
                      <td className="py-1.5 font-semibold text-gray-600 first-letter:uppercase">{bucket.fullLabel}</td>
                      <td className="py-1.5 text-right font-mono font-bold tabular-nums text-gray-900">
                        {bucket.total.toLocaleString("fr-FR")}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-gray-600">
                        {bucket.primary.toLocaleString("fr-FR")}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-gray-400">
                        {(bucket.total - bucket.primary).toLocaleString("fr-FR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Clé de légende : un aplat pour une série dessinée en aplat, jamais du texte coloré —
// l'identité vient de la pastille à côté du libellé.
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-[11px] font-bold text-gray-600">{label}</span>
    </span>
  );
}
