import { useState, useEffect } from "react";
import { Sparkles, Clock, CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { VendorRequest } from "../types";
import { authFetch } from "../lib/apiClient";
import { fetchVendorCategories, VendorCategory } from "../lib/vendorCategories";

const MAX_CATEGORIES = 3;

interface BecomeVendorCardProps {
  // Optionnel : sans lui, l'état "approuvée" reste un simple message plutôt qu'un lien vers le
  // tableau de bord — c'est le cas d'un appelant qui n'a pas de navigation à proposer.
  setActiveTab?: (tab: string) => void;
}

// Parcours "devenir prestataire", jumeau de BecomeOrganizerCard.tsx. Différence : la bascule
// n'accorde pas d'accès à l'encaissement (ce n'est pas un rôle), donc n'importe quel compte
// peut demander une fiche, y compris un compte déjà organisateur — et contrairement au passage
// organisateur, aucune reconnexion n'est nécessaire : le tableau de bord est accessible tout
// de suite après approbation.
export default function BecomeVendorCard({ setActiveTab }: BecomeVendorCardProps) {
  const [request, setRequest] = useState<VendorRequest | null>(null);
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [categorySlugs, setCategorySlugs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [res, cats] = await Promise.all([
          authFetch("/api/account/vendor-request", { method: "GET" }),
          fetchVendorCategories(),
        ]);
        setCategories(cats);
        if (res.ok) {
          const data = await res.json();
          setRequest(data.request || null);
        }
      } catch {
        // Statut indisponible : la carte reste utilisable pour déposer une demande.
      } finally {
        setLoaded(true);
      }
    })();
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
    if (categorySlugs.length === 0) {
      setError("Choisissez au moins une catégorie.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch("/api/account/vendor-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, phone, city, description, categorySlugs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Impossible d'envoyer votre demande.");
      setRequest(data);
      setFormOpen(false);
      setBusinessName("");
      setPhone("");
      setCity("");
      setDescription("");
      setCategorySlugs([]);
    } catch (err: any) {
      setError(err.message || "Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) return null;

  if (request?.status === "pending") {
    return (
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4" id="vendor-request-pending">
        <div className="flex items-center gap-2.5 text-sm font-bold text-amber-800">
          <Clock className="h-4.5 w-4.5 shrink-0" />
          Demande prestataire en cours d'examen
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-amber-700">
          Votre demande pour <strong>{request.businessName}</strong> a été transmise le{" "}
          {new Date(request.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
          L'équipe ClicBillet vous recontacte au {request.phone} et vous informera par e-mail de sa décision.
        </p>
      </div>
    );
  }

  if (request?.status === "approved") {
    return (
      <div className="rounded-2xl border border-green-100 bg-green-50 p-4" id="vendor-request-approved">
        <div className="flex items-center gap-2.5 text-sm font-bold text-green-800">
          <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
          Fiche prestataire publiée
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-green-700">
          Complétez votre fiche (alias, photos, catégories) depuis votre espace prestataire.
        </p>
        {setActiveTab && (
          <button
            onClick={() => setActiveTab("vendor-dashboard")}
            className="mt-3 flex items-center gap-1.5 text-xs font-black text-green-800 hover:underline"
          >
            Aller à mon espace prestataire
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (!formOpen) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-xs" id="become-vendor-card">
        {request?.status === "rejected" && (
          <div className="border-b border-gray-50 p-4">
            <div className="flex items-center gap-2.5 text-sm font-bold text-gray-700">
              <XCircle className="h-4.5 w-4.5 shrink-0 text-red-500" />
              Demande précédente non retenue
            </div>
            {request.reviewNote && (
              <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-gray-500">{request.reviewNote}</p>
            )}
          </div>
        )}
        <button
          onClick={() => setFormOpen(true)}
          className="flex w-full items-center justify-between px-4 py-3.5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50"
        >
          <span className="flex items-center gap-2.5">
            <Sparkles className="h-4.5 w-4.5 text-orange-600" />
            {request?.status === "rejected" ? "Soumettre une nouvelle demande" : "Devenir prestataire"}
          </span>
          <ChevronRight className="h-4 w-4 text-gray-300" />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-xs" id="become-vendor-form">
      <div className="flex items-center gap-2.5 text-sm font-bold text-gray-800">
        <Sparkles className="h-4.5 w-4.5 text-orange-600" />
        Devenir prestataire
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
        Publiez une fiche vitrine (photographe, régie, MC, traiteur...) sur le marché de
        prestataires. L'équipe ClicBillet vérifie chaque demande avant publication.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-600" id="vendor-request-error">{error}</p>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="vendor-request-name" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
            Nom de votre structure
          </label>
          <input
            id="vendor-request-name"
            type="text"
            required
            maxLength={120}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Ex : Kouassi Studio Photo"
            className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="vendor-request-phone" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
              Téléphone
            </label>
            <input
              id="vendor-request-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex : +225 07 00 00 00 00"
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
            />
          </div>
          <div>
            <label htmlFor="vendor-request-city" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
              Ville
            </label>
            <input
              id="vendor-request-city"
              type="text"
              required
              maxLength={100}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Ex : Abidjan"
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-black uppercase tracking-wider text-gray-500">
            Catégories <span className="font-bold normal-case tracking-normal text-gray-400">(jusqu'à {MAX_CATEGORIES})</span>
          </label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {categories.map((cat) => {
              const selected = categorySlugs.includes(cat.slug);
              return (
                <button
                  type="button"
                  key={cat.slug}
                  onClick={() => toggleCategory(cat.slug)}
                  disabled={!selected && categorySlugs.length >= MAX_CATEGORIES}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 ${
                    selected
                      ? "border-orange-600 bg-orange-600 text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:border-orange-300"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="vendor-request-description" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
            Votre activité <span className="font-bold normal-case tracking-normal text-gray-400">(facultatif)</span>
          </label>
          <textarea
            id="vendor-request-description"
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Type de prestations, expérience, matériel disponible..."
            className="mt-1 w-full resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-xl bg-orange-600 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-orange-700 disabled:bg-gray-300"
        >
          {submitting ? "Envoi..." : "Envoyer ma demande"}
        </button>
        <button
          type="button"
          onClick={() => { setFormOpen(false); setError(null); }}
          className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
