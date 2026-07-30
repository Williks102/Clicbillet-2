import { useState } from "react";
import { X, Percent, Check } from "lucide-react";
import ResponsiveSheet from "./ResponsiveSheet";
import { Event } from "../types";

interface CommissionSheetProps {
  event: Event;
  platformDefaultRate: number;
  onClose: () => void;
  onSave: (commissionRate: number | null) => Promise<void>;
}

/**
 * Remplace l'ancien window.prompt() de définition du taux de commission par un sheet
 * cohérent avec le reste de l'app : choix explicite entre taux par défaut de la plateforme
 * et taux négocié pour cet événement, avec validation avant envoi plutôt qu'après coup.
 */
export default function CommissionSheet({ event, platformDefaultRate, onClose, onSave }: CommissionSheetProps) {
  const [mode, setMode] = useState<"default" | "custom">(event.commissionRate != null ? "custom" : "default");
  const [percent, setPercent] = useState(
    event.commissionRate != null ? (event.commissionRate * 100).toString() : (platformDefaultRate * 100).toFixed(0)
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);

    if (mode === "default") {
      setSaving(true);
      try {
        await onSave(null);
      } catch (e: any) {
        setError(e.message || "Erreur lors de la mise à jour.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const value = Number(percent.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setError("Entrez un taux entre 0 et 100.");
      return;
    }

    setSaving(true);
    try {
      await onSave(value / 100);
    } catch (e: any) {
      setError(e.message || "Erreur lors de la mise à jour.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveSheet id="commission-sheet" onClose={onClose} panelClassName="max-w-md overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-4 border-b border-gray-100">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-gray-950">Commission</h3>
          <p className="text-[11px] text-gray-400 font-semibold truncate max-w-xs">{event.title}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 shrink-0" id="commission-sheet-close">
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setMode("default")}
            className={`w-full flex items-center justify-between rounded-2xl border p-3.5 text-left transition ${
              mode === "default" ? "border-orange-600 bg-orange-50" : "border-gray-200 hover:border-orange-300"
            }`}
          >
            <div>
              <span className="block text-xs font-black text-gray-950">Taux par défaut de la plateforme</span>
              <span className="block text-[11px] text-gray-500 font-semibold mt-0.5">{(platformDefaultRate * 100).toFixed(0)}% appliqué à tous les événements sans taux négocié</span>
            </div>
            {mode === "default" && <Check className="h-4 w-4 text-orange-600 shrink-0 ml-2" />}
          </button>

          <button
            type="button"
            onClick={() => setMode("custom")}
            className={`w-full flex items-center justify-between rounded-2xl border p-3.5 text-left transition ${
              mode === "custom" ? "border-orange-600 bg-orange-50" : "border-gray-200 hover:border-orange-300"
            }`}
          >
            <span className="text-xs font-black text-gray-950">Taux personnalisé pour cet événement</span>
            {mode === "custom" && <Check className="h-4 w-4 text-orange-600 shrink-0 ml-2" />}
          </button>
        </div>

        {mode === "custom" && (
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-700">Taux négocié</label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-2.5 pr-9 pl-3.5 text-sm font-bold outline-none focus:border-orange-500"
                placeholder="15"
              />
              <Percent className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
        )}

        {error && <p className="text-[11px] font-bold text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-xs font-bold text-gray-500 hover:text-gray-700"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-black uppercase text-white transition active:scale-95 disabled:opacity-60"
            id="commission-sheet-save"
          >
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
