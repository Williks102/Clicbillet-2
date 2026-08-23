import React, { useEffect, useState } from "react";
import { Plus, Eye, EyeOff, Trash2, Check, X, Pencil } from "lucide-react";
import { authFetch } from "../../lib/apiClient";
import { iconeDeCategoriePrestataire } from "../../lib/vendorCategories";

// Gestion du référentiel des catégories de prestataires, jumeau de CategorySettings.tsx
// (catégories d'événements), depuis l'onglet Configuration. Voir ce fichier pour le
// raisonnement détaillé : même mécanique, référentiel séparé (supabase_setup.sql section 30).

interface CategorieVendorAdmin {
  slug: string;
  label: string;
  icon: string;
  sortOrder: number;
  active: boolean;
}

const ICONES_PROPOSEES = ["Tag", "Camera", "Video", "Music", "Lightbulb", "Mic2", "UtensilsCrossed", "Sparkles", "ShieldCheck"];

export default function VendorCategorySettings() {
  const [categories, setCategories] = useState<CategorieVendorAdmin[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouvelleIcone, setNouvelleIcone] = useState("Tag");
  const [enCours, setEnCours] = useState(false);
  const [renommage, setRenommage] = useState<{ slug: string; label: string } | null>(null);

  async function charger() {
    setChargement(true);
    try {
      const r = await authFetch("/api/admin/vendor-categories");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Chargement impossible.");
      setCategories(data);
      setErreur(null);
    } catch (e: any) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => { charger(); }, []);

  async function appeler(chemin: string, options: RequestInit, succes?: string) {
    setEnCours(true);
    setErreur(null);
    setInfo(null);
    try {
      const r = await authFetch(chemin, options);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Opération impossible.");
      setInfo(data.message || succes || null);
      await charger();
    } catch (e: any) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    if (!nouveauNom.trim()) return;
    await appeler("/api/admin/vendor-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: nouveauNom.trim(), icon: nouvelleIcone })
    }, `Catégorie « ${nouveauNom.trim()} » créée.`);
    setNouveauNom("");
    setNouvelleIcone("Tag");
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-black text-gray-900">Catégories de prestataires</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Cette liste alimente à la fois les filtres du marché de prestataires et le choix proposé
          lors d'une demande de fiche : les deux ne peuvent plus diverger. Une catégorie masquée
          disparaît de ces listes sans toucher aux fiches qui la portent déjà.
        </p>
      </div>

      {erreur && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[11px] font-bold text-red-700">{erreur}</div>
      )}
      {info && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[11px] font-bold text-emerald-800">{info}</div>
      )}

      <form onSubmit={creer} className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex-1 min-w-[180px] space-y-1">
          <label className="text-[10px] font-black uppercase tracking-wider text-gray-400">Nouvelle catégorie</label>
          <input
            type="text"
            value={nouveauNom}
            onChange={(e) => setNouveauNom(e.target.value)}
            placeholder="Ex : Location de matériel"
            maxLength={60}
            className="w-full rounded-xl border border-gray-200 py-2.5 px-3 text-xs outline-none focus:border-orange-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase tracking-wider text-gray-400">Icône</label>
          <select
            value={nouvelleIcone}
            onChange={(e) => setNouvelleIcone(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white py-2.5 px-3 text-xs outline-none focus:border-orange-500"
          >
            {ICONES_PROPOSEES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <button
          type="submit"
          disabled={enCours || !nouveauNom.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-black text-white transition-colors hover:bg-orange-700 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {chargement ? (
          <p className="p-6 text-center text-xs text-gray-400">Chargement…</p>
        ) : categories.length === 0 ? (
          <p className="p-6 text-center text-xs text-gray-400">Aucune catégorie.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {categories.map((cat) => {
              const Icone = iconeDeCategoriePrestataire(cat.icon);
              const enRenommage = renommage?.slug === cat.slug;
              return (
                <li key={cat.slug} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${cat.active ? "" : "bg-gray-50"}`}>
                  <Icone className={`h-4 w-4 shrink-0 ${cat.active ? "text-orange-600" : "text-gray-400"}`} />

                  {enRenommage ? (
                    <input
                      autoFocus
                      value={renommage.label}
                      onChange={(e) => setRenommage({ slug: cat.slug, label: e.target.value })}
                      className="flex-1 min-w-[140px] rounded-lg border border-orange-300 py-1.5 px-2 text-xs outline-none"
                    />
                  ) : (
                    <div className="flex-1 min-w-[140px]">
                      <p className={`text-xs font-black ${cat.active ? "text-gray-900" : "text-gray-400"}`}>{cat.label}</p>
                      <p className="font-mono text-[10px] text-gray-400">{cat.slug}</p>
                    </div>
                  )}

                  {!cat.active && (
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[9px] font-black uppercase text-gray-500">Masquée</span>
                  )}

                  <div className="flex items-center gap-1">
                    {enRenommage ? (
                      <>
                        <button
                          onClick={() => {
                            appeler(`/api/admin/vendor-categories/${cat.slug}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ label: renommage.label })
                            }, "Nom mis à jour.");
                            setRenommage(null);
                          }}
                          disabled={enCours}
                          className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50"
                          title="Valider"
                        ><Check className="h-3.5 w-3.5" /></button>
                        <button
                          onClick={() => setRenommage(null)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-50"
                          title="Annuler"
                        ><X className="h-3.5 w-3.5" /></button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setRenommage({ slug: cat.slug, label: cat.label })}
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                          title="Renommer"
                        ><Pencil className="h-3.5 w-3.5" /></button>
                        <button
                          onClick={() => appeler(`/api/admin/vendor-categories/${cat.slug}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ active: !cat.active })
                          }, cat.active ? "Catégorie masquée." : "Catégorie affichée.")}
                          disabled={enCours}
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                          title={cat.active ? "Masquer" : "Afficher"}
                        >{cat.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                        <button
                          onClick={() => {
                            if (!confirm(`Supprimer « ${cat.label} » ? Si des fiches prestataires l'utilisent, elle sera simplement masquée.`)) return;
                            appeler(`/api/admin/vendor-categories/${cat.slug}`, { method: "DELETE" }, "Catégorie supprimée.");
                          }}
                          disabled={enCours}
                          className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          title="Supprimer"
                        ><Trash2 className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
