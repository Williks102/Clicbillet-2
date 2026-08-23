import { useEffect, useState } from "react";
import {
  Sparkles, AtSign, CheckCircle2, AlertCircle, Inbox, Mail, Phone, Calendar as CalendarIcon,
  Upload, X, ImagePlus
} from "lucide-react";
import { User } from "../types";
import { authFetch } from "../lib/apiClient";
import { compressImageToDataUrl } from "../lib/imageCompress";
import { fetchVendorCategories, VendorCategory } from "../lib/vendorCategories";
import DashboardMobileMenu from "./DashboardMobileMenu";
import BecomeVendorCard from "./BecomeVendorCard";
import { PageSkeleton } from "./Skeleton";

interface VendorDashboardProps {
  user: User;
}

type VendorSubTab = "profile" | "leads";

const MAX_PORTFOLIO_IMAGES = 6;
const MAX_DESCRIPTION_LENGTH = 1000;

interface VendorProfile {
  id: string;
  alias: string | null;
  businessName: string;
  phone: string;
  city: string;
  description: string | null;
  coverImage: string | null;
  portfolioImages: string[];
  categorySlugs: string[];
}

interface VendorLead {
  id: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string | null;
  eventDate: string | null;
  message: string;
  createdAt: string;
}

// Tableau de bord prestataire (marché de prestataires), jumeau — en plus simple, deux sections
// au lieu de six — de la carte "Ma page publique" d'OrganizerDashboard.tsx : édition de la
// fiche (alias, coordonnées, catégories, photos) et boîte de réception des demandes de devis.
export default function VendorDashboard({ user }: VendorDashboardProps) {
  const [subTab, setSubTab] = useState<VendorSubTab>("profile");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [categories, setCategories] = useState<VendorCategory[]>([]);

  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [categorySlugs, setCategorySlugs] = useState<string[]>([]);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [portfolioImages, setPortfolioImages] = useState<string[]>([]);

  const [alias, setAlias] = useState("");
  const [savedAlias, setSavedAlias] = useState<string | null>(null);
  const [aliasCheck, setAliasCheck] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [aliasCheckMessage, setAliasCheckMessage] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const [leads, setLeads] = useState<VendorLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);

  useEffect(() => {
    fetchVendorCategories().then(setCategories);
    authFetch("/api/vendor/profile", { method: "GET" })
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return; }
        if (!res.ok) throw new Error();
        const data: VendorProfile = await res.json();
        setBusinessName(data.businessName);
        setPhone(data.phone);
        setCity(data.city);
        setDescription(data.description || "");
        setCategorySlugs(data.categorySlugs);
        setCoverImage(data.coverImage);
        setPortfolioImages(data.portfolioImages);
        setAlias(data.alias || "");
        setSavedAlias(data.alias || null);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (subTab !== "leads") return;
    setLeadsLoading(true);
    authFetch("/api/vendor/leads", { method: "GET" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setLeads(Array.isArray(data) ? data : []))
      .catch(() => setLeads([]))
      .finally(() => setLeadsLoading(false));
  }, [subTab]);

  // Vérifie la disponibilité de l'alias en direct, même mécanique que OrganizerDashboard.tsx.
  useEffect(() => {
    const trimmed = alias.trim().toLowerCase();
    if (!trimmed || trimmed === savedAlias) {
      setAliasCheck("idle");
      setAliasCheckMessage(null);
      return;
    }
    setAliasCheck("checking");
    const timeout = setTimeout(() => {
      authFetch(`/api/vendor/check-alias?alias=${encodeURIComponent(trimmed)}`, { method: "GET" })
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            setAliasCheck("invalid");
            setAliasCheckMessage(data.error);
          } else if (data.available) {
            setAliasCheck("available");
            setAliasCheckMessage(null);
          } else {
            setAliasCheck("taken");
            setAliasCheckMessage("Cet alias est déjà pris.");
          }
        })
        .catch(() => setAliasCheck("idle"));
    }, 400);
    return () => clearTimeout(timeout);
  }, [alias, savedAlias]);

  function toggleCategory(slug: string) {
    setCategorySlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= 3) return prev;
      return [...prev, slug];
    });
  }

  function handleCoverFile(file: File) {
    setImageError(null);
    if (!file.type.startsWith("image/")) {
      setImageError("Veuillez sélectionner un fichier image (JPG, PNG, GIF, WEBP).");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setImageError("La taille de l'image ne doit pas dépasser 4 Mo.");
      return;
    }
    compressImageToDataUrl(file).then(setCoverImage).catch(() => setImageError("Impossible de traiter cette image."));
  }

  function handlePortfolioFile(file: File) {
    setImageError(null);
    if (portfolioImages.length >= MAX_PORTFOLIO_IMAGES) {
      setImageError(`Le portfolio est limité à ${MAX_PORTFOLIO_IMAGES} photos.`);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setImageError("Veuillez sélectionner un fichier image (JPG, PNG, GIF, WEBP).");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setImageError("La taille de l'image ne doit pas dépasser 4 Mo.");
      return;
    }
    compressImageToDataUrl(file)
      .then((dataUrl) => setPortfolioImages((prev) => [...prev, dataUrl]))
      .catch(() => setImageError("Impossible de traiter cette image."));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await authFetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias, businessName, phone, city, description, categorySlugs, coverImage, portfolioImages,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de la mise à jour.");
      setSavedAlias(alias.trim().toLowerCase() || null);
      setSaveMessage({ type: "success", text: "Fiche prestataire mise à jour !" });
    } catch (err: any) {
      setSaveMessage({ type: "error", text: err.message || "Échec de la mise à jour." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <PageSkeleton id="vendor-dashboard-loading" label="Ouverture de l'espace prestataire" />;
  }

  if (notFound) {
    // Pas de fiche (pas encore demandée, ou demande en cours/refusée) : le formulaire de
    // demande s'affiche directement ici plutôt que de renvoyer vers le profil — accéder à
    // "mon espace prestataire" depuis la nav doit marcher qu'on ait déjà une fiche ou non.
    return (
      <div className="mx-auto max-w-lg py-10" id="vendor-dashboard-not-found">
        <div className="mb-6 text-center">
          <Sparkles className="mx-auto h-10 w-10 text-orange-300" />
          <h3 className="mt-3 text-base font-bold text-gray-900">Aucune fiche prestataire pour l'instant</h3>
          <p className="mt-1.5 text-xs text-gray-500">
            Publiez une fiche vitrine (photographe, régie, MC, traiteur...) sur le marché de prestataires.
          </p>
        </div>
        <BecomeVendorCard startOpen />
      </div>
    );
  }

  const SUB_TAB_LABELS: Record<VendorSubTab, string> = { profile: "Ma fiche", leads: "Demandes reçues" };
  const SUB_TAB_ICONS: Record<VendorSubTab, React.ReactNode> = {
    profile: <AtSign className="h-4 w-4" />,
    leads: <Inbox className="h-4 w-4" />,
  };

  return (
    <div className="space-y-8 py-6" id="vendor-dashboard-wrapper">
      <section className="space-y-4 border-b border-gray-100 pb-5">
        <div className="min-w-0">
          <h2 className="flex items-start gap-1.5 text-lg font-black text-gray-900 sm:items-center sm:text-xl">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-orange-600 sm:mt-0" />
            <span className="min-w-0 break-words">Espace Prestataire : {user.name}</span>
          </h2>
          <p className="mt-1 text-xs text-gray-500 font-semibold uppercase tracking-wider">
            Fiche vitrine & demandes de devis
          </p>
        </div>

        <div className="hidden lg:flex flex-wrap gap-2">
          {(Object.keys(SUB_TAB_LABELS) as VendorSubTab[]).map((tab) => (
            <button
              key={tab}
              id={`vendor-dashboard-tab-${tab}`}
              onClick={() => setSubTab(tab)}
              className={`flex items-center space-x-1.5 rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
                subTab === tab ? "bg-slate-950 text-white shadow-md" : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-100"
              }`}
            >
              {SUB_TAB_ICONS[tab]}
              <span>{SUB_TAB_LABELS[tab]}</span>
            </button>
          ))}
        </div>

        <DashboardMobileMenu
          title="Menu Prestataire"
          activeLabel={SUB_TAB_LABELS[subTab]}
          items={(Object.keys(SUB_TAB_LABELS) as VendorSubTab[]).map((tab) => ({
            key: tab,
            label: SUB_TAB_LABELS[tab],
            icon: SUB_TAB_ICONS[tab],
            active: subTab === tab,
            onSelect: () => setSubTab(tab),
          }))}
        />
      </section>

      {subTab === "profile" ? (
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-4" id="vendor-public-profile-card">
            <div className="border-b border-gray-50 pb-3">
              <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide flex items-center space-x-1.5">
                <AtSign className="h-4 w-4 text-orange-500" />
                <span>Ma page publique</span>
              </h4>
              <p className="mt-1.5 text-xs text-gray-500">
                Un alias donne à votre fiche une page dédiée, partageable sur vos réseaux
                (clicbillet.ci/p/votre-alias). Sans alias, votre fiche n'apparaît pas sur le marché de prestataires.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Alias public</label>
              <div className="flex items-center rounded-xl border border-gray-200 overflow-hidden">
                <span className="shrink-0 bg-gray-50 px-3 py-2.5 text-xs font-bold text-gray-400 border-r border-gray-200">
                  clicbillet.ci/p/
                </span>
                <input
                  id="vendor-alias-input"
                  type="text"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value.toLowerCase())}
                  placeholder="votre-nom-activite"
                  className="flex-1 px-3 py-2.5 text-xs outline-none min-w-0"
                />
              </div>
              {aliasCheck === "checking" && <p className="mt-1.5 text-[11px] font-semibold text-gray-400">Vérification...</p>}
              {aliasCheck === "available" && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Alias disponible
                </p>
              )}
              {(aliasCheck === "taken" || aliasCheck === "invalid") && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-red-500">
                  <AlertCircle className="h-3.5 w-3.5" /> {aliasCheckMessage}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-gray-700">Nom de la structure</label>
                <input
                  type="text"
                  maxLength={120}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-gray-700">Ville</label>
                <input
                  type="text"
                  maxLength={100}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Téléphone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-gray-200 p-2.5 text-xs outline-none focus:border-orange-400"
              />
              <p className="mt-1 text-[10px] text-gray-400">Jamais affiché publiquement — seules vos demandes de devis vous parviennent.</p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Catégories <span className="font-normal text-gray-400">(jusqu'à 3)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => {
                  const selected = categorySlugs.includes(cat.slug);
                  return (
                    <button
                      type="button"
                      key={cat.slug}
                      onClick={() => toggleCategory(cat.slug)}
                      disabled={!selected && categorySlugs.length >= 3}
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
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                rows={3}
                placeholder="Présentez votre activité en quelques mots..."
                className="w-full rounded-xl border border-gray-200 p-3 text-xs outline-none resize-none focus:border-orange-400"
              />
              <p className="mt-1 text-right text-[10px] text-gray-400 font-semibold">{description.length} / {MAX_DESCRIPTION_LENGTH}</p>
            </div>

            {imageError && (
              <p className="text-xs font-bold text-red-500">{imageError}</p>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Photo de couverture</label>
              {coverImage ? (
                <div className="relative w-fit">
                  <img src={coverImage} alt="Couverture" className="h-28 w-44 rounded-xl border border-gray-200 object-cover" />
                  <button
                    type="button"
                    onClick={() => setCoverImage(null)}
                    className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-red-500 shadow-md hover:border-red-600 hover:bg-red-600 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 px-4 py-3 text-xs font-bold text-gray-500 hover:border-orange-400 hover:bg-gray-50">
                  <Upload className="h-4 w-4 text-orange-600" />
                  Importer une photo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCoverFile(f); e.target.value = ""; }} />
                </label>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">
                Portfolio <span className="font-normal text-gray-400">({portfolioImages.length} / {MAX_PORTFOLIO_IMAGES})</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {portfolioImages.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt={`Portfolio ${i + 1}`} className="h-20 w-20 rounded-xl border border-gray-200 object-cover" />
                    <button
                      type="button"
                      onClick={() => setPortfolioImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-red-500 shadow-md hover:border-red-600 hover:bg-red-600 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {portfolioImages.length < MAX_PORTFOLIO_IMAGES && (
                  <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-orange-400 hover:text-orange-600">
                    <ImagePlus className="h-5 w-5" />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePortfolioFile(f); e.target.value = ""; }} />
                  </label>
                )}
              </div>
            </div>

            {saveMessage && (
              <p className={`text-xs font-bold ${saveMessage.type === "success" ? "text-green-600" : "text-red-500"}`}>
                {saveMessage.text}
              </p>
            )}

            <button
              onClick={handleSave}
              disabled={saving || aliasCheck === "checking" || aliasCheck === "taken" || aliasCheck === "invalid" || !alias.trim() || categorySlugs.length === 0}
              className="min-h-11 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white transition-colors hover:bg-orange-700 disabled:opacity-50 sm:min-h-0 sm:py-2"
            >
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-4" id="vendor-leads-card">
          <div className="border-b border-gray-50 pb-3">
            <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide flex items-center space-x-1.5">
              <Inbox className="h-4 w-4 text-orange-500" />
              <span>Demandes de devis reçues</span>
            </h4>
            <p className="mt-1.5 text-xs text-gray-500">
              Répondez directement par e-mail ou téléphone : ClicBillet ne gère pas les échanges au-delà de la demande initiale.
            </p>
          </div>

          {leadsLoading ? (
            <p className="py-10 text-center text-xs font-semibold text-gray-400">Chargement...</p>
          ) : leads.length === 0 ? (
            <p className="py-10 text-center text-xs font-semibold text-gray-400">Aucune demande reçue pour le moment.</p>
          ) : (
            <div className="space-y-3">
              {leads.map((lead) => (
                <div key={lead.id} id={`vendor-lead-${lead.id}`} className="rounded-2xl border border-gray-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-gray-950">{lead.senderName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-gray-500">
                        <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {lead.senderEmail}</span>
                        {lead.senderPhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {lead.senderPhone}</span>}
                        {lead.eventDate && <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" /> {lead.eventDate}</span>}
                      </p>
                    </div>
                    <p className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {new Date(lead.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600">
                    {lead.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
