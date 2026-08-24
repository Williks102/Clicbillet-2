import { useEffect, useState } from "react";
import { X, Check, Copy, CheckCircle2, UserPlus } from "lucide-react";
import ResponsiveSheet from "./ResponsiveSheet";
import { authFetch } from "../lib/apiClient";
import { fetchVendorCategories, VendorCategory } from "../lib/vendorCategories";

interface CreateAccountSheetProps {
  onClose: () => void;
  // Appelé à la fermeture du panneau, mais seulement si un compte a été créé pendant cette
  // ouverture (jamais sur un simple "Annuler") : rafraîchit la liste des membres. Pas plus tôt
  // — fetchAdminData() affiche un écran de chargement plein écran le temps de la requête, ce
  // qui démonterait ce panneau et perdrait le mot de passe avant que l'admin ait pu le copier.
  onCreated: () => void;
}

const MAX_CATEGORIES = 3;

interface CreatedAccount {
  email: string;
  temporaryPassword: string;
  vendorProfileError: string | null;
}

// Création directe d'un compte organisateur ou prestataire par l'admin (cf. POST
// /api/admin/users, server/routes/admin.ts) : pour distribuer des comptes prêts à l'emploi à
// des personnes déjà identifiées, sans leur faire passer inscription + confirmation par e-mail
// (et, pour un prestataire, une demande supplémentaire).
export default function CreateAccountSheet({ onClose, onCreated }: CreateAccountSheetProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"client" | "organizer">("organizer");
  const [wantsVendorProfile, setWantsVendorProfile] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [categorySlugs, setCategorySlugs] = useState<string[]>([]);
  const [categories, setCategories] = useState<VendorCategory[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchVendorCategories().then(setCategories);
  }, []);

  function toggleCategory(slug: string) {
    setCategorySlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= MAX_CATEGORIES) return prev;
      return [...prev, slug];
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (wantsVendorProfile && categorySlugs.length === 0) {
      setError("Choisissez au moins une catégorie pour la fiche prestataire.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          role,
          vendorProfile: wantsVendorProfile ? { businessName, phone, city, description, categorySlugs } : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de la création du compte.");

      // Le rafraîchissement de la liste (onCreated) n'a lieu qu'à la fermeture du panneau, pas
      // ici : fetchAdminData() affiche un écran de chargement plein écran le temps de la
      // requête, ce qui démonterait ce panneau et perdrait le mot de passe avant que l'admin
      // ait pu le copier.
      setCreated({ email: data.user.email, temporaryPassword: data.temporaryPassword, vendorProfileError: data.vendorProfileError || null });
    } catch (err: any) {
      setError(err.message || "Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyPassword() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé, permission refusée...) : le mot de
      // passe reste affiché et copiable à la main, rien d'autre à faire.
    }
  }

  // Un seul chemin de fermeture, quel que soit le déclencheur (X, clic sur l'overlay, geste de
  // balayage mobile, bouton "Terminé") : la liste des membres n'est rafraîchie qu'à la
  // fermeture, et seulement si un compte a bien été créé pendant cette ouverture du panneau.
  function handleClose() {
    if (created) onCreated();
    onClose();
  }

  return (
    <ResponsiveSheet id="create-account-sheet" onClose={handleClose} panelClassName="max-w-lg overflow-hidden border border-gray-100 flex flex-col max-h-[92dvh] sm:max-h-[90vh]">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-50 bg-gray-50/50 px-6 py-4">
        <h3 className="flex items-center gap-2 text-sm font-black text-gray-900">
          <UserPlus className="h-4.5 w-4.5 text-orange-600" />
          {created ? "Compte créé" : "Créer un compte"}
        </h3>
        <button onClick={handleClose} aria-label="Fermer" className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <X className="h-4.5 w-4.5" />
        </button>
      </div>

      <div className="overflow-y-auto p-6">
        {created ? (
          <div className="space-y-4" id="create-account-success">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-100 bg-green-50 px-4 py-3">
              <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-green-600" />
              <p className="text-xs font-bold text-green-800">
                Compte créé pour {created.email}. Copiez le mot de passe ci-dessous — il ne sera plus jamais affiché.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Mot de passe temporaire</label>
              <div className="flex items-center rounded-xl border border-gray-200 overflow-hidden">
                <code className="flex-1 px-3.5 py-3 font-mono text-sm font-bold text-gray-900 select-all">{created.temporaryPassword}</code>
                <button
                  type="button"
                  onClick={handleCopyPassword}
                  className="flex shrink-0 items-center gap-1.5 border-l border-gray-200 bg-gray-50 px-3.5 py-3 text-xs font-black text-gray-600 hover:bg-gray-100"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copié" : "Copier"}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                Transmettez-le vous-même à la personne concernée (WhatsApp, en main propre...). Elle pourra le changer depuis son profil.
              </p>
            </div>

            {created.vendorProfileError && (
              <p className="rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-700">{created.vendorProfileError}</p>
            )}

            <button
              type="button"
              onClick={handleClose}
              className="w-full rounded-xl bg-orange-600 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-orange-700"
            >
              Terminé
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" id="create-account-form">
            {error && (
              <p className="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-600" id="create-account-error">{error}</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="create-account-name" className="mb-1.5 block text-xs font-bold text-gray-700">Nom complet</label>
                <input
                  id="create-account-name"
                  type="text"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
                />
              </div>
              <div>
                <label htmlFor="create-account-email" className="mb-1.5 block text-xs font-bold text-gray-700">E-mail</label>
                <input
                  id="create-account-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Rôle</label>
              <div className="flex gap-2">
                {(["organizer", "client"] as const).map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setRole(r)}
                    className={`flex-1 rounded-xl border px-3.5 py-2.5 text-xs font-bold transition-colors ${
                      role === r ? "border-orange-600 bg-orange-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:border-orange-300"
                    }`}
                  >
                    {r === "organizer" ? "Organisateur" : "Client"}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2.5 rounded-xl border border-gray-200 px-3.5 py-3 text-xs font-bold text-gray-700">
              <input
                type="checkbox"
                checked={wantsVendorProfile}
                onChange={(e) => setWantsVendorProfile(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
              />
              Créer aussi une fiche prestataire pour ce compte
            </label>

            {wantsVendorProfile && (
              <div className="space-y-3 rounded-xl border border-orange-100 bg-orange-50/40 p-4" id="create-account-vendor-fields">
                <div>
                  <label htmlFor="create-account-business-name" className="mb-1.5 block text-xs font-bold text-gray-700">Nom de la structure</label>
                  <input
                    id="create-account-business-name"
                    type="text"
                    required={wantsVendorProfile}
                    maxLength={120}
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Ex : Kouassi Studio Photo"
                    className="w-full rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="create-account-phone" className="mb-1.5 block text-xs font-bold text-gray-700">Téléphone</label>
                    <input
                      id="create-account-phone"
                      type="tel"
                      required={wantsVendorProfile}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+225 07 00 00 00 00"
                      className="w-full rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
                    />
                  </div>
                  <div>
                    <label htmlFor="create-account-city" className="mb-1.5 block text-xs font-bold text-gray-700">Ville</label>
                    <input
                      id="create-account-city"
                      type="text"
                      required={wantsVendorProfile}
                      maxLength={100}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Abidjan"
                      className="w-full rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-gray-700">
                    Catégories <span className="font-normal text-gray-400">(jusqu'à {MAX_CATEGORIES})</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((cat) => {
                      const selected = categorySlugs.includes(cat.slug);
                      return (
                        <button
                          type="button"
                          key={cat.slug}
                          onClick={() => toggleCategory(cat.slug)}
                          disabled={!selected && categorySlugs.length >= MAX_CATEGORIES}
                          className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 ${
                            selected ? "border-orange-600 bg-orange-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:border-orange-300"
                          }`}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="create-account-description" className="mb-1.5 block text-xs font-bold text-gray-700">
                    Description <span className="font-normal text-gray-400">(facultatif)</span>
                  </label>
                  <textarea
                    id="create-account-description"
                    rows={2}
                    maxLength={1000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button type="button" onClick={handleClose} className="rounded-xl px-4 py-2.5 text-xs font-bold text-gray-500 hover:text-gray-700">
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-black uppercase text-white transition active:scale-95 disabled:opacity-60"
              >
                {submitting ? "Création..." : "Créer le compte"}
              </button>
            </div>
          </form>
        )}
      </div>
    </ResponsiveSheet>
  );
}
