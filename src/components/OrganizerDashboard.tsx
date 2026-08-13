import React, { useState, useEffect, useMemo } from "react";
import { Plus, LayoutDashboard, BarChart3, Calendar, MapPin, Tag, Users, DollarSign, ListCollapse, Image as ImageIcon, Sparkles, Check, Upload, SlidersHorizontal, RefreshCw, Play, Hammer, X, AtSign, CheckCircle2, AlertCircle, Receipt, Download } from "lucide-react";
import { Event, User, SalesStatus, PassDesign } from "../types";
import { authFetch } from "../lib/apiClient";
import ResponsiveSheet from "./ResponsiveSheet";
import { isEventPast, EVENT_SCAN_GRACE_HOURS, EVENT_DEFAULT_DURATION_HOURS } from "../lib/eventStatus";
import { BannerUploadZone } from "./BannerUploadZone";
import { fetchCategories, cleDeLEvenement, type Category } from "../lib/categories";
import { printHtmlDocument, escapeHtml } from "../lib/printDocument";
import { isVipTier, formatTierLabel, formatSaleWindowLabel } from "../lib/ticketTier";
import { isPaidTicket } from "../lib/ticketPayment";
import PassDesignEditor from "./PassDesignEditor";
import { PASS_DESIGN_PAR_DEFAUT, resolvePassDesign } from "../lib/passDesign";
import DashboardMobileMenu from "./DashboardMobileMenu";
import AccountCodeBadge from "./AccountCodeBadge";
import WeeklySalesChart from "./WeeklySalesChart";
import OrganizerReports from "./OrganizerReports";
import { normalizeReport } from "../lib/reportStats";

interface OrganizerDashboardProps {
  user: User;
  events: Event[];
  onEventCreated: () => void;
  setActiveTab: (tab: string) => void;
}

type OrganizerSubTab = "dashboard" | "reports" | "create" | "simulator" | "payouts" | "invoices";

// Ligne de la grille tarifaire en cours de saisie : tout y est chaîne de caractères, la
// conversion en nombres se faisant à l'envoi.
type TierDraft = { name: string; price: string; total: string; salesStart: string; salesEnd: string };

// Un tarif vide ne part pas au serveur ; on ne conserve que ce qui est réellement renseigné.
//
// prixDeBase : un champ prix laissé vide signifie « le prix de base de l'événement », pas
// « gratuit ». Le convertir en 0 mettait le billet en distribution gratuite sans que rien ne
// le signale — l'événement affichait son prix de base au catalogue, la page de l'événement
// annonçait 0 F, et l'achat court-circuitait la passerelle de paiement pour émettre un billet
// gratuit. Un organisateur pouvait ainsi donner toute sa salle sans jamais s'en apercevoir.
function nettoyerTarifs(brouillons: TierDraft[], prixDeBase: number) {
  return brouillons
    .filter((t) => t.name.trim() !== "")
    .map((t) => ({
      name: t.name.trim(),
      price: t.price.trim() === "" ? prixDeBase : Number(t.price) || 0,
      total: Number(t.total) || 0,
      salesStart: t.salesStart ? t.salesStart.slice(0, 16) : null,
      salesEnd: t.salesEnd ? t.salesEnd.slice(0, 16) : null,
    }));
}

const ORGANIZER_SUB_TAB_LABELS: Record<OrganizerSubTab, string> = {
  dashboard: "Suivi des Ventes",
  reports: "Rapports",
  create: "Créer un Événement",
  simulator: "Simulateur Sandbox",
  payouts: "Retraits & Soldes",
  invoices: "Mes Factures"
};

const ORGANIZER_SUB_TAB_ICONS: Record<OrganizerSubTab, React.ReactNode> = {
  dashboard: <LayoutDashboard className="h-4 w-4" />,
  reports: <BarChart3 className="h-4 w-4" />,
  create: <Plus className="h-4 w-4" />,
  simulator: <Hammer className="h-4 w-4" />,
  payouts: <DollarSign className="h-4 w-4" />,
  invoices: <ListCollapse className="h-4 w-4" />
};


// Curated banner collections for easy selection
const BANNER_TEMPLATES = [
  {
    name: "Musique Concert",
    url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&auto=format&fit=crop&q=60",
    category: "Concert"
  },
  {
    name: "Festival & BBQ Outdoor",
    url: "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=60",
    category: "Festivals"
  },
  {
    name: "Spectacle Humour Scène",
    url: "https://images.unsplash.com/photo-1516280440614-37939bbacd6a?w=800&auto=format&fit=crop&q=60",
    category: "Théâtre & Humour"
  },
  {
    name: "Sport & Stade Foot",
    url: "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60",
    category: "Sport"
  },
  {
    name: "Conférence & Luxe",
    url: "https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&auto=format&fit=crop&q=60",
    category: "Professionnel"
  }
];

interface MonthlyStatement {
  key: string; // "2026-08"
  label: string; // "Août 2026"
  tickets: SalesStatus["tickets"];
  grossAmount: number;
  commissionAmount: number;
  netAmount: number;
}

// Regroupe les ventes confirmées par mois calendaire pour produire un relevé de commission
// automatique, sans aucune saisie manuelle. Le taux appliqué est le taux effectif déjà
// calculé par le serveur (peut mélanger plusieurs événements à taux différents) : une
// approximation raisonnable, cohérente avec les autres indicateurs déjà affichés au-dessus.
function groupMonthlyStatements(tickets: SalesStatus["tickets"], commissionRate: number): MonthlyStatement[] {
  const groups = new Map<string, SalesStatus["tickets"]>();
  for (const t of tickets) {
    if (!isPaidTicket(t)) continue;
    const d = new Date(t.purchaseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return Array.from(groups.entries())
    .map(([key, tkts]) => {
      const gross = tkts.reduce((sum, t) => sum + t.pricePaid, 0);
      const commission = Math.floor(gross * commissionRate);
      const [y, m] = key.split("-").map(Number);
      const rawLabel = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      return {
        key,
        label: rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1),
        tickets: tkts,
        grossAmount: gross,
        commissionAmount: commission,
        netAmount: gross - commission,
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}

function buildOrganizerInvoiceHtml(statement: MonthlyStatement, organizerName: string, commissionRatePercent: number): string {
  const rows = statement.tickets
    .map(
      (t) => `
      <tr>
        <td>${new Date(t.purchaseDate).toLocaleDateString("fr-FR")}</td>
        <td>${escapeHtml(t.eventTitle)}</td>
        <td>${escapeHtml(t.buyerName)}</td>
        <td class="right">${t.pricePaid.toLocaleString("fr-FR")} FCFA</td>
      </tr>`
    )
    .join("");

  return `
    <div class="header">
      <div>
        <div class="brand">clic<span>billet</span></div>
        <p class="muted" style="margin:4px 0 0;">Relevé de commission</p>
      </div>
      <div class="right">
        <p style="margin:0; font-weight:700;">${escapeHtml(statement.label)}</p>
        <p class="muted" style="margin:4px 0 0;">${escapeHtml(organizerName)}</p>
      </div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Événement</th><th>Acheteur</th><th class="right">Montant</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Ventes brutes</span><span>${statement.grossAmount.toLocaleString("fr-FR")} FCFA</span></div>
      <div class="totals-row"><span>Commission ClicBillet (${commissionRatePercent}%)</span><span>-${statement.commissionAmount.toLocaleString("fr-FR")} FCFA</span></div>
      <div class="totals-row grand"><span>Net reversé</span><span>${statement.netAmount.toLocaleString("fr-FR")} FCFA</span></div>
    </div>
    <div class="footer">Relevé généré automatiquement à partir de vos ventes confirmées sur ClicBillet.</div>
  `;
}

export default function OrganizerDashboard({ user, events, onEventCreated, setActiveTab }: OrganizerDashboardProps) {
  const [subTab, setSubTab] = useState<OrganizerSubTab>("dashboard");
  const [stats, setStats] = useState<SalesStatus | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Form Fields for Creation
  const [title, setTitle] = useState("");

  // ... (keeping standard hooks)
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  // Fin de l'événement : facultative, mais c'est elle qui ferme la fenêtre de scan des billets.
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [price, setPrice] = useState("");
  // salesStart/salesEnd : fenêtre de vente facultative propre au tarif (early bird, pass
  // tardif), saisie en datetime-local et envoyée telle quelle ("YYYY-MM-DDTHH:MM").
  const [ticketTypes, setTicketTypes] = useState<TierDraft[]>([{ name: 'Standard', price: '', total: '', salesStart: '', salesEnd: '' }]);
  const [passDesign, setPassDesign] = useState<PassDesign>({ ...PASS_DESIGN_PAR_DEFAUT });
  const [venue, setVenue] = useState("");
  const [category, setCategory] = useState("concert");
  const [totalTickets, setTotalTickets] = useState("");
  const [scheduledOnsale, setScheduledOnsale] = useState(false);
  // Même référentiel que les filtres du catalogue : une catégorie proposée ici a forcément
  // sa puce sur l'accueil, ce qui n'était pas garanti tant que les deux listes étaient
  // codées en dur séparément.
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    let annule = false;
    fetchCategories().then((liste) => { if (!annule) setCategories(liste); });
    return () => { annule = true; };
  }, []);
  const [selectedBanner, setSelectedBanner] = useState(BANNER_TEMPLATES[0].url);
  const [customBannerUrl, setCustomBannerUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Event Editing States
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editTicketTypes, setEditTicketTypes] = useState<TierDraft[]>([]);
  // Habillage du pass : chargé à l'ouverture de la fenêtre de modification via son endpoint
  // dédié, et non lu depuis l'événement du catalogue — le logo et l'image de fond n'y sont
  // volontairement pas embarqués (cf. GET /api/events/:id/pass-design).
  const [editPassDesign, setEditPassDesign] = useState<PassDesign>({ ...PASS_DESIGN_PAR_DEFAUT });
  const [editPassDesignLoading, setEditPassDesignLoading] = useState(false);

  // Tarifs qui partiraient à 0 F : un billet gratuit est parfaitement légitime, mais il court-
  // circuite le paiement, donc il ne doit jamais résulter d'un champ oublié.
  const tarifsGratuits = nettoyerTarifs(ticketTypes, Number(price) || 0).filter((t) => t.price === 0).map((t) => t.name);
  const tarifsGratuitsEdition = nettoyerTarifs(editTicketTypes, Number(editPrice) || 0).filter((t) => t.price === 0).map((t) => t.name);
  const [editVenue, setEditVenue] = useState("");
  const [editCategory, setEditCategory] = useState("concert");
  const [editTotalTickets, setEditTotalTickets] = useState("");
  const [editScheduledOnsale, setEditScheduledOnsale] = useState(false);
  const [editSelectedBanner, setEditSelectedBanner] = useState("");
  const [editCustomBannerUrl, setEditCustomBannerUrl] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Sandbox Simulator States
  const [simSelectedEventId, setSimSelectedEventId] = useState("");
  const [simQuantity, setSimQuantity] = useState("1");
  const [simTier, setSimTier] = useState<string>("standard");
  const [simBuyerName, setSimBuyerName] = useState("Sylla Lansana");
  const [simBuyerEmail, setSimBuyerEmail] = useState("lansana@fofana.ci");
  const [simPaymentMethod, setSimPaymentMethod] = useState("orange_money");
  const [simulatingCheckout, setSimulatingCheckout] = useState(false);
  const [simulatedTickets, setSimulatedTickets] = useState<any[]>([]);
  const [loadingSimTickets, setLoadingSimTickets] = useState(false);
  const [simStatusMsg, setSimStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Payout States
  const [payouts, setPayouts] = useState<any[]>([]);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("Wave");
  const [payoutDetails, setPayoutDetails] = useState("");
  const [submittingPayout, setSubmittingPayout] = useState(false);

  // Page publique organisateur (alias + bio)
  const [profileAlias, setProfileAlias] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [savedAlias, setSavedAlias] = useState<string | null>(null);
  const [aliasCheck, setAliasCheck] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [aliasCheckMessage, setAliasCheckMessage] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveMessage, setProfileSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Auto pre-fill Simulator Selected Event state
  useEffect(() => {
    const myEvts = events.filter(e => e.organizerId === user.id);
    if (myEvts.length > 0 && !simSelectedEventId) {
      setSimSelectedEventId(myEvts[0].id);
    }
  }, [events, user.id]);

  // Charge l'alias/bio actuels au montage (page publique organisateur)
  useEffect(() => {
    authFetch("/api/organizer/profile", { method: "GET" })
      .then((res) => res.json())
      .then((data) => {
        setProfileAlias(data.alias || "");
        setProfileBio(data.bio || "");
        setSavedAlias(data.alias || null);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vérifie la disponibilité de l'alias en direct pendant la saisie (debounce 400ms) — ne
  // revérifie pas si l'alias tapé est celui déjà enregistré.
  useEffect(() => {
    const trimmed = profileAlias.trim().toLowerCase();
    if (!trimmed || trimmed === savedAlias) {
      setAliasCheck("idle");
      setAliasCheckMessage(null);
      return;
    }
    setAliasCheck("checking");
    const timeout = setTimeout(() => {
      authFetch(`/api/organizer/check-alias?alias=${encodeURIComponent(trimmed)}`, { method: "GET" })
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
        .catch(() => {
          setAliasCheck("idle");
        });
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileAlias, savedAlias]);

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileSaveMessage(null);
    try {
      const res = await authFetch("/api/organizer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: profileAlias, bio: profileBio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de la mise à jour.");
      setSavedAlias(data.alias);
      setProfileAlias(data.alias);
      setProfileBio(data.bio);
      setProfileSaveMessage({ type: "success", text: "Profil public mis à jour !" });
    } catch (err: any) {
      setProfileSaveMessage({ type: "error", text: err.message || "Échec de la mise à jour." });
    } finally {
      setProfileSaving(false);
    }
  }

  // Fetch simulated purchased tickets list for manual scan verification
  async function fetchSimulatedTickets() {
    setLoadingSimTickets(true);
    try {
      const response = await authFetch(`/api/organizer/stats?organizerId=${user.id}`, {});
      if (response.ok) {
        const data = await response.json();
        setSimulatedTickets(data.tickets || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSimTickets(false);
    }
  }

    async function downloadOrganizerExport() {
      try {
        const response = await authFetch(`/api/organizer/export?organizerId=${user.id}`, {
          method: "GET"
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Impossible de générer l'export.");
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `clicbillet_organizer_export_${Date.now()}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(url);
      } catch (err: any) {
        console.error(err);
        alert(err.message || "Impossible de télécharger l'export.");
      }
    }

    // Habillage du pass de l'événement à modifier. En cas d'échec on repart du thème par
    // défaut plutôt que de bloquer la fenêtre : l'organisateur peut vouloir corriger un tout
    // autre champ, et rien n'est écrasé tant qu'il n'enregistre pas.
    async function chargerPassDesign(eventId: string) {
      setEditPassDesignLoading(true);
      try {
        const response = await authFetch(`/api/events/${eventId}/pass-design`);
        if (!response.ok) throw new Error("Habillage indisponible.");
        setEditPassDesign(resolvePassDesign(await response.json()));
      } catch {
        setEditPassDesign({ ...PASS_DESIGN_PAR_DEFAUT });
      } finally {
        setEditPassDesignLoading(false);
      }
    }

    function openEdit(evt: Event) {
      setEditingEvent(evt);
      chargerPassDesign(evt.id);
      setEditTitle(evt.title);
    setEditDescription(evt.description);
    setEditDate(evt.date);
    setEditTime(evt.time);
    setEditEndDate(evt.endDate || "");
    setEditEndTime(evt.endTime || "");
    setEditPrice(String(evt.price));
    setEditVenue(evt.venue);
    setEditCategory(cleDeLEvenement(evt));
    setEditTotalTickets(String(evt.totalTickets));
    setEditTicketTypes((evt.ticketTypes || []).map(t => ({
      name: t.name,
      price: String(t.price),
      total: String(t.total || ''),
      salesStart: t.salesStart || '',
      salesEnd: t.salesEnd || '',
    })));
    setEditScheduledOnsale(Boolean(evt.scheduledOnsale));
    if (BANNER_TEMPLATES.some(b => b.url === evt.banner)) {
      setEditSelectedBanner(evt.banner);
      setEditCustomBannerUrl("");
    } else {
      setEditSelectedBanner("");
      setEditCustomBannerUrl(evt.banner);
    }
    setEditError(null);
  }

  async function handleUpdateEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!editingEvent) return;
    setEditSubmitting(true);
    setEditError(null);

    const bannerPath = editCustomBannerUrl.trim() !== "" ? editCustomBannerUrl.trim() : editSelectedBanner;

    const cleanedEditTiers = nettoyerTarifs(editTicketTypes, Number(editPrice) || 0);
    const tierTotalSum = cleanedEditTiers.reduce((s, t) => s + t.total, 0);
    const payload = {
      title: editTitle,
      description: editDescription,
      date: editDate,
      time: editTime,
      endDate: editEndDate || null,
      endTime: editEndTime || null,
      price: Number(editPrice),
      ticketTypes: cleanedEditTiers,
      venue: editVenue,
      category: editCategory,
      banner: bannerPath,
      totalTickets: tierTotalSum > 0 ? tierTotalSum : Number(editTotalTickets),
      organizerId: user.id,
      scheduledOnsale: editScheduledOnsale,
      passDesign: editPassDesign
    };

    try {
      const response = await authFetch(`/api/events/${editingEvent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      let data: any = {};
      try { data = await response.json(); } catch { /* réponse non-JSON (ex. 413, 502) */ }
      if (!response.ok) {
        throw new Error(data.error || `Erreur serveur (${response.status}).`);
      }
      setEditingEvent(null);
      onEventCreated(); // refresh events
    } catch (err: any) {
      setEditError(err.message || "Impossible de sauvegarder la mise à jour.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleSimulatePurchase(e: React.FormEvent) {
    e.preventDefault();
    if (!simSelectedEventId) {
      setSimStatusMsg({ type: "error", text: "Veuillez d'abord créer un événement pour pouvoir lancer la simulation." });
      return;
    }
    setSimulatingCheckout(true);
    setSimStatusMsg(null);

    const payload = {
      eventId: simSelectedEventId,
      buyerName: simBuyerName,
      buyerEmail: simBuyerEmail,
      items: [{ tier: simTier, quantity: Number(simQuantity) }],
      paymentDetails: {
        method: simPaymentMethod,
        phoneNumber: "0707070707"
      }
    };

    try {
      const response = await authFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Échec de simuler le checkout.");
      }

      const simulatedTicket = data.tickets?.[0];
      setSimStatusMsg({
        type: "success",
        text: `Achat simulé avec succès ! Billet #${simulatedTicket?.id} enregistré. Commande générée sous la réf ${data.orderId}`
      });

      // Quick re-init input parameters for variation
      setSimBuyerName(["Marie-Ange Kouamé", "Fouad Bakayoko", "Yuki Touré", "Cheikh Cissé"][Math.floor(Math.random() * 4)]);
      setSimBuyerEmail(`test-${Math.floor(Math.random() * 900)}@clicbillet.ci`);

      onEventCreated(); // refresh dashboard metrics & stocks
      fetchSimulatedTickets(); // refreshes local table list
    } catch (err: any) {
      setSimStatusMsg({ type: "error", text: err.message || "Erreur de simulation d'achat." });
    } finally {
      setSimulatingCheckout(false);
    }
  }

  async function handleSimulateScan(qrCodeData: string) {
    try {
      const response = await authFetch("/api/verify-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrCodeData, organizerId: user.id })
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        alert(data.error || "Erreur de validation de scan.");
      } else {
        if (data.alreadyScanned) {
          alert(`Alerte Sécurité : Ce billet a déjà été validé à : ${new Date(data.scannedAt).toLocaleTimeString("fr-FR")}`);
        } else {
          alert(`Validation Réussie ! Entrée autorisée pour ${data.ticket.buyerName} (${data.ticket.tier.toUpperCase()})`);
        }
      }
      fetchSimulatedTickets();
    } catch (e: any) {
      alert("Impossible de simuler le scanner central.");
    }
  }


  // Fetch sales report stats from backend API
  async function fetchStats() {
    try {
      const [response, payoutRes] = await Promise.all([
        authFetch(`/api/organizer/stats?organizerId=${user.id}`, {}),
        authFetch(`/api/organizer/payouts?organizerId=${user.id}`, {})
      ]);
      if (!response.ok) {
        throw new Error("Impossible de charger les statistiques.");
      }
      const data = await response.json();
      setStats(data);

      if (payoutRes.ok) {
        setPayouts(await payoutRes.json());
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingStats(false);
    }
  }

  useEffect(() => {
    fetchStats();
  }, [user.id, events]);

  async function handleRequestPayout(e: React.FormEvent) {
    e.preventDefault();
    if (Number(payoutAmount) <= 0) {
       alert("Montant invalide.");
       return;
    }
    setSubmittingPayout(true);
    try {
      const resp = await authFetch("/api/organizer/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizerId: user.id, amount: payoutAmount, method: payoutMethod, details: payoutDetails })
      });
      if (!resp.ok) throw new Error("Erreur de demande.");
      
      const newPayout = await resp.json();
      setPayouts([newPayout.payout, ...payouts]);
      setPayoutAmount("");
      setPayoutDetails("");
      alert("Demande de retrait effectuée ! Elle sera traitée par l'administration.");
    } catch(err: any) { alert(err.message); }
    finally { setSubmittingPayout(false); }
  }

  // Handle building new Event
  async function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(false);
    setSubmitting(true);

    const bannerPath = customBannerUrl.trim() !== "" ? customBannerUrl.trim() : selectedBanner;
    const cleanedTiers = nettoyerTarifs(ticketTypes, Number(price) || 0);

    const payload = {
      title,
      description,
      date,
      time,
      endDate: endDate || null,
      endTime: endTime || null,
      price: Number(price),
      ticketTypes: cleanedTiers,
      venue,
      category,
      banner: bannerPath,
      // La capacité se déduit des quotas RÉELLEMENT envoyés : la sommer sur les brouillons
      // comptait aussi les lignes sans nom, que le serveur écarte — la grille annonçait alors
      // moins de places que la jauge globale de l'événement.
      totalTickets: cleanedTiers.reduce((s, t) => s + t.total, 0) || Number(totalTickets),
      organizerId: user.id,
      organizerName: user.name,
      scheduledOnsale,
      passDesign
    };

    try {
      const response = await authFetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data: any = {};
      try { data = await response.json(); } catch { /* réponse non-JSON (ex. 413, 502) */ }
      if (!response.ok) {
        throw new Error(data.error || `Erreur serveur (${response.status}).`);
      }

      // Success
      setFormSuccess(true);
      onEventCreated(); // refresh data
      
      // Clear fields
      setTitle("");
      setDescription("");
      setDate("");
      setTime("");
      setEndDate("");
      setEndTime("");
      setPrice("");
      setTicketTypes([{ name: 'Standard', price: '', total: '', salesStart: '', salesEnd: '' }]);
      setPassDesign({ ...PASS_DESIGN_PAR_DEFAUT });
      setVenue("");
      setTotalTickets("");
      setScheduledOnsale(false);
      setCustomBannerUrl("");

      // Delay redirect to dashboard view
      setTimeout(() => {
        setSubTab("dashboard");
        setFormSuccess(false);
      }, 1500);

    } catch (err: any) {
      setFormError(err.message || "Erreur de création.");
    } finally {
      setSubmitting(false);
    }
  }

  // Filter events created specifically by this organizer
  const myEvents = events.filter((e) => e.organizerId === user.id);

  // CA brut par événement, pour l'afficher sur la jauge de ventes de chaque carte évènement.
  const eventRevenueByEventId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of stats?.tickets || []) {
      map[t.eventId] = (map[t.eventId] || 0) + Number(t.pricePaid || 0);
    }
    return map;
  }, [stats]);

  return (
    <div className="space-y-8 py-6" id="organizer-dashboard-wrapper">
      
      {/* Header and Toggle Navigation */}
      <section className="space-y-4 border-b border-gray-100 pb-5">
        <div className="min-w-0">
          <h2 className="flex items-start gap-1.5 text-lg font-black text-gray-900 sm:items-center sm:text-xl">
            <LayoutDashboard className="mt-0.5 h-5 w-5 shrink-0 text-orange-600 sm:mt-0" />
            <span className="min-w-0 break-words">Espace Organisateur : {user.name}</span>
          </h2>
          <p className="mt-1 text-xs text-gray-500 font-semibold uppercase tracking-wider">
            Tableau de Bord & Création d'événements
          </p>
          <AccountCodeBadge code={user.publicCode} className="mt-3" />
        </div>

        {/* Dash selector pills (desktop / large écrans uniquement), sur leur propre ligne
            pleine largeur pour ne pas se faire écraser par un nom d'organisateur long. */}
        <div className="hidden lg:flex flex-wrap gap-2">
          <button
            id="orga-dashboard-view-tab"
            onClick={() => setSubTab("dashboard")}
            className={`rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
              subTab === "dashboard"
                ? "bg-slate-950 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-100"
            }`}
          >
            Suivi des Ventes
          </button>
          <button
            id="orga-reports-view-tab"
            onClick={() => setSubTab("reports")}
            className={`flex items-center space-x-1 rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
              subTab === "reports"
                ? "bg-slate-950 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-100"
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            <span>Rapports</span>
          </button>
          <button
            id="orga-create-view-tab"
            onClick={() => setSubTab("create")}
            className={`flex items-center space-x-1 rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
              subTab === "create"
                ? "bg-slate-950 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-100"
            }`}
          >
            <Plus className="h-4 w-4" />
            <span>Créer un Événement</span>
          </button>
          <button
            id="orga-simulator-view-tab"
            onClick={() => setSubTab("simulator")}
            className={`flex items-center space-x-1.5 rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 text-orange-950 border ${
              subTab === "simulator"
                ? "bg-orange-600 text-white border-orange-500 shadow-md shadow-orange-100"
                : "bg-orange-50/70 border-orange-200 hover:bg-orange-100"
            }`}
          >
            <Hammer className="h-4 w-4" />
            <span>Simulateur Sandbox</span>
          </button>
          <button
            id="orga-payouts-view-tab"
            onClick={() => setSubTab("payouts")}
            className={`flex items-center space-x-1.5 rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
              subTab === "payouts"
                ? "bg-slate-950 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-100"
            }`}
          >
            <DollarSign className="h-4 w-4" />
            <span>Retraits & Soldes</span>
          </button>
          <button
            id="orga-invoices-view-tab"
            onClick={() => setSubTab("invoices")}
            className={`flex items-center space-x-1.5 rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
              subTab === "invoices"
                ? "bg-slate-950 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-100"
            }`}
          >
            <Receipt className="h-4 w-4" />
            <span>Mes Factures</span>
          </button>
        </div>

        {/* Menu hamburger mobile : remplace les pills ci-dessus sous "lg" */}
        <DashboardMobileMenu
          title="Menu Organisateur"
          activeLabel={ORGANIZER_SUB_TAB_LABELS[subTab]}
          items={(Object.keys(ORGANIZER_SUB_TAB_LABELS) as OrganizerSubTab[]).map((tab) => ({
            key: tab,
            label: ORGANIZER_SUB_TAB_LABELS[tab],
            icon: ORGANIZER_SUB_TAB_ICONS[tab],
            active: subTab === tab,
            onSelect: () => setSubTab(tab)
          }))}
        />
      </section>

      {subTab === "dashboard" ? (
        <div className="space-y-8" id="orga-sales-dash-view">
          <div className="flex justify-end">
            <button
               onClick={downloadOrganizerExport}
               className="flex items-center space-x-1.5 rounded-xl px-4 py-2 text-xs font-black transition-all bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 active:scale-95 shadow-sm"
            >
              <Upload className="h-4 w-4" />
              <span>Exporter en CSV</span>
            </button>
          </div>

          {/* Performance Overview Badges */}
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 flex flex-col justify-between shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
              <div className="flex items-center space-x-4">
                <div className="rounded-xl bg-orange-50 p-3 text-orange-600">
                  <DollarSign className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-gray-400 font-sans tracking-wider block">Solde Organisateur (Net)</span>
                  <span className="text-xl font-extrabold text-slate-900 font-sans">
                    {loadingStats ? "Chargement..." : `${(stats?.totalRevenue || 0).toLocaleString("fr-FR")} F CFA`}
                  </span>
                </div>
              </div>
              {!loadingStats && stats && (
                <div className="mt-3.5 pt-2.5 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400 font-semibold font-sans">
                  <span>Brut total : {(stats.totalGrossRevenue || 0).toLocaleString("fr-FR")} F</span>
                  <span className="text-orange-600">Com. Plateforme (-{Math.round((stats.commissionRate || 0) * 100)}%) : -{(stats.totalCommission || 0).toLocaleString("fr-FR")} F</span>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-5 flex items-center space-x-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
              <div className="rounded-xl bg-amber-50 p-3 text-amber-600">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-gray-400 font-sans tracking-wider block">Tickets Vendus</span>
                <span className="text-xl font-extrabold text-gray-950 font-sans">
                  {loadingStats ? "Chargement..." : `${stats?.ticketsSold || 0} ticket${(stats?.ticketsSold || 0) > 1 ? "s" : ""}`}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-5 flex items-center space-x-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
              <div className="rounded-xl bg-purple-50 p-3 text-purple-600">
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-gray-400 font-sans tracking-wider block">Mes événements actifs</span>
                <span className="text-xl font-extrabold text-gray-950 font-sans">
                  {myEvents.length} événements
                </span>
              </div>
            </div>
          </div>

          {/* Aesthetic Sales Graph & Recent Sales Table Grid */}
          <div className="grid gap-6 lg:grid-cols-5">
            <WeeklySalesChart tickets={stats?.tickets} loading={loadingStats} />

            {/* Recent purchasing activities logs */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:col-span-2">
              <h4 className="text-sm font-black text-gray-900 pb-4 border-b border-gray-50">
                Activités de Vente Récentes
              </h4>

              <div className="mt-4 space-y-3 max-h-48 overflow-y-auto scrollbar-thin">
                {stats && stats.recentSales && stats.recentSales.length > 0 ? (
                  stats.recentSales.map((sale, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-100/50">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-gray-950 truncate">{sale.buyerName}</p>
                        <p className="text-[10px] text-gray-400 font-mono truncate">{sale.eventTitle}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-extrabold text-orange-600 block">+{sale.amount.toLocaleString("fr-FR")} F</span>
                        <span className="text-[9px] text-gray-400 uppercase font-mono font-semibold">
                          {formatTierLabel(sale.tier)}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-400 font-semibold py-8 text-center">Aucune transaction récente pour l'instant.</p>
                )}
              </div>
            </div>
          </div>

          {/* List of active created events by this organizer */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5">
            <h4 className="text-sm font-black text-gray-900 pb-4 border-b border-gray-50">
              Mes Événements ({myEvents.length})
            </h4>

            {myEvents.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {myEvents.map((evt) => {
                  const soldRatio = evt.ticketsSold / evt.totalTickets;
                  const remains = evt.totalTickets - evt.ticketsSold;
                  const isPast = evt.status === "approved" && isEventPast(evt);
                  const eventRevenue = eventRevenueByEventId[evt.id] || 0;

                  return (
                    <div key={evt.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* Name / Location column */}
                      <div className="flex items-center space-x-3.5">
                        <img 
                          src={evt.banner} 
                          alt="" 
                          className="h-12 w-12 rounded-xl object-cover" 
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <div className="flex items-center space-x-2">
                             <h5 className="text-xs font-extrabold text-gray-950 max-w-sm truncate">{evt.title}</h5>
                             {evt.status === "pending" ? (
                               <span className="px-1.5 bg-amber-50 text-amber-600 rounded text-[8px] font-bold uppercase">En Attente</span>
                             ) : evt.status === "rejected" ? (
                               <span className="px-1.5 bg-red-50 text-red-600 rounded text-[8px] font-bold uppercase">Rejeté</span>
                             ) : isPast ? (
                               <span className="px-1.5 bg-slate-100 text-slate-500 rounded text-[8px] font-bold uppercase">Terminé</span>
                             ) : (
                               <span className="px-1.5 bg-emerald-50 text-emerald-600 rounded text-[8px] font-bold uppercase">Approuvé</span>
                             )}
                          </div>
                          <div className="flex items-center space-x-2 text-[10px] text-gray-400 mt-1">
                            <span className="bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded-sm font-bold uppercase">{evt.category}</span>
                            <span>{new Date(evt.date).toLocaleDateString("fr-FR")} à {evt.time}</span>
                          </div>
                        </div>
                      </div>

                      {/* Sold gauge tracker */}
                      <div className="flex-1 max-w-xs block scale-95 md:scale-100">
                        <div className="flex justify-between text-[10px] font-bold text-gray-500 mb-1">
                          <span>{evt.ticketsSold} / {evt.totalTickets} tickets vendus</span>
                          <span>{Math.round(soldRatio * 100)}%</span>
                        </div>
                        <div className="relative h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${Math.min(100, soldRatio * 100)}%` }}
                            className="bg-orange-600 h-full rounded-full transition-all"
                          />
                        </div>
                        <p className="mt-1.5 text-[10px] font-semibold text-gray-400">
                          {evt.ticketsSold} billet{evt.ticketsSold > 1 ? "s" : ""} vendu{evt.ticketsSold > 1 ? "s" : ""} · <span className="text-orange-600 font-bold">{eventRevenue.toLocaleString("fr-FR")} F CFA</span> de CA
                        </p>
                      </div>

                      {/* CTA Action details */}
                      <div className="flex items-center space-x-4">
                        <div className="text-right text-xs">
                          <span className="font-extrabold text-gray-950 font-sans tracking-wide block">{evt.price.toLocaleString("fr-FR")} XOF</span>
                          <span className="text-[10px] text-gray-400 mt-0.5 font-sans font-semibold block">{remains} places restantes</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEdit(evt)}
                          className="rounded-xl border border-gray-200 hover:border-orange-500 hover:text-orange-600 bg-white p-2 text-xs text-gray-500 font-bold transition flex items-center space-x-1"
                          title="Modifier les détails de l'événement"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                          </svg>
                          <span className="hidden sm:inline">Modifier</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 py-6 text-center font-semibold">Créez votre premier événement pour commencer à vendre des tickets !</p>
            )}
          </div>

          {/* Page publique organisateur : alias + bio */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-4" id="orga-public-profile-card">
            <div className="border-b border-gray-50 pb-3">
              <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide flex items-center space-x-1.5">
                <AtSign className="h-4 w-4 text-orange-500" />
                <span>Ma page publique</span>
              </h4>
              <p className="mt-1.5 text-xs text-gray-500">
                Un alias vous donne une page regroupant tous vos événements, partageable sur vos réseaux
                (clicbillet.ci/o/votre-alias). Le nom de votre organisation devient cliquable sur vos fiches
                événement dès qu'un alias est défini.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Alias public</label>
              <div className="flex items-center rounded-xl border border-gray-200 overflow-hidden">
                <span className="shrink-0 bg-gray-50 px-3 py-2.5 text-xs font-bold text-gray-400 border-r border-gray-200">
                  clicbillet.ci/o/
                </span>
                <input
                  id="organizer-alias-input"
                  type="text"
                  value={profileAlias}
                  onChange={(e) => setProfileAlias(e.target.value.toLowerCase())}
                  placeholder="votre-nom-organisation"
                  className="flex-1 px-3 py-2.5 text-xs outline-none min-w-0"
                />
              </div>
              {aliasCheck === "checking" && (
                <p className="mt-1.5 text-[11px] font-semibold text-gray-400">Vérification...</p>
              )}
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

            <div>
              <label className="mb-1.5 block text-xs font-bold text-gray-700">Bio (visible sur votre page publique)</label>
              <textarea
                id="organizer-bio-input"
                value={profileBio}
                onChange={(e) => setProfileBio(e.target.value.slice(0, 280))}
                rows={3}
                placeholder="Présentez-vous en quelques mots..."
                className="w-full rounded-xl border border-gray-200 p-3 text-xs outline-none resize-none focus:border-orange-400"
              />
              <p className="mt-1 text-right text-[10px] text-gray-400 font-semibold">{profileBio.length} / 280</p>
            </div>

            {profileSaveMessage && (
              <p className={`text-xs font-bold ${profileSaveMessage.type === "success" ? "text-green-600" : "text-red-500"}`}>
                {profileSaveMessage.text}
              </p>
            )}

            <button
              onClick={handleSaveProfile}
              disabled={profileSaving || aliasCheck === "checking" || aliasCheck === "taken" || aliasCheck === "invalid" || !profileAlias.trim()}
              className="rounded-xl bg-orange-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
            >
              {profileSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </div>
      ) : subTab === "reports" ? (
        <OrganizerReports stats={stats} events={myEvents} loading={loadingStats} report={normalizeReport((stats as any)?.report)} />
      ) : subTab === "create" ? (
        /* Create New Event Form Layout */
        <form onSubmit={handleCreateEvent} className="min-w-0 rounded-2xl border border-gray-100/70 bg-white p-4 space-y-5 sm:p-6 sm:space-y-6" id="orga-create-form-view">
          <div className="border-b border-gray-50 pb-4">
            <h3 className="flex items-start gap-1.5 text-base font-black text-gray-900 sm:items-center">
              <Sparkles className="mt-0.5 h-4.5 w-4.5 shrink-0 text-orange-600 sm:mt-0" />
              <span className="break-words">Publiez un Nouvel Événement</span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5 font-medium">Prenez soin de définir des tarifs clairs adaptés aux spectateurs ivoiriens.</p>
          </div>

          {formError && (
            <div className="rounded-lg bg-red-50 p-3.5 text-xs font-semibold text-red-600 border border-red-100">
              {formError}
            </div>
          )}

          {formSuccess && (
            <div className="rounded-lg bg-green-50 p-3.5 text-xs font-semibold text-green-700 border border-green-100 flex items-center space-x-2">
              <Check className="h-4 w-4" />
              <span>Félicitations ! L'événement a été publié avec succès.</span>
            </div>
          )}

          {/* Form grid values */}
          <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2">
            
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-bold text-gray-700">Titre de l'événement</label>
              <input
                type="text"
                required
                placeholder="Ex : Concert Live Exceptionnel d'Artiste à l'Agora"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-bold text-gray-700">Description de l'événement</label>
              <textarea
                rows={3}
                placeholder="Décrivez le programme, les artistes invités, les conditions de participation..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 text-gray-700"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Heure de début</label>
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 text-gray-700"
              />
            </div>

            {/* Fin de l'événement : c'est elle qui ferme la fenêtre de scan. La laisser vide
                revient à accepter la durée forfaitaire par défaut. Si l'organisateur ne saisit
                qu'une heure de fin, on complète la date par celle du début (cas le plus courant). */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">
                Date de fin <span className="font-semibold text-gray-400">(facultatif)</span>
              </label>
              <input
                type="date"
                min={date || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 text-gray-700"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">
                Heure de fin <span className="font-semibold text-gray-400">(facultatif)</span>
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  if (e.target.value && !endDate) setEndDate(date);
                }}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 text-gray-700"
              />
            </div>

            <p className="sm:col-span-2 -mt-1 text-[11px] font-medium text-gray-500">
              Les billets cessent d'être scannables {EVENT_SCAN_GRACE_HOURS} h après la fin.
              Sans fin renseignée, l'événement est considéré comme durant {EVENT_DEFAULT_DURATION_HOURS} h.
            </p>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Prix de base (Franc CFA - XOF)</label>
              <input
                type="number"
                required
                min="0"
                step="500"
                placeholder="Ex : 5000"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Types de billets</label>
              <div className="hidden grid-cols-3 gap-1 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 sm:grid">
                <span>Catégorie</span><span>Prix (XOF)</span><span>Places</span>
              </div>
              <div className="space-y-2">
                {ticketTypes.map((tier, idx) => (
                  <div key={idx} className="space-y-2 rounded-2xl border border-gray-100 p-2 sm:border-0 sm:p-0">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <input
                      type="text"
                      placeholder="Ex: VIP"
                      value={tier.name}
                      onChange={(e) => {
                        const newTiers = [...ticketTypes];
                        newTiers[idx].name = e.target.value;
                        setTicketTypes(newTiers);
                      }}
                      aria-label="Catégorie du billet"
                      className="min-w-0 rounded-xl border border-gray-200 py-3 px-3 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                    />
                    <input
                      type="number"
                      min="0"
                      step="500"
                      placeholder="15000"
                      value={tier.price}
                      onChange={(e) => {
                        const newTiers = [...ticketTypes];
                        newTiers[idx].price = e.target.value;
                        setTicketTypes(newTiers);
                      }}
                      aria-label="Prix du billet"
                      className="min-w-0 rounded-xl border border-gray-200 py-3 px-3 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="100"
                      value={tier.total}
                      onChange={(e) => {
                        const newTiers = [...ticketTypes];
                        newTiers[idx].total = e.target.value;
                        setTicketTypes(newTiers);
                      }}
                      aria-label="Nombre de places du billet"
                      className="min-w-0 rounded-xl border border-gray-200 py-3 px-3 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => setTicketTypes(ticketTypes.filter((_, i) => i !== idx))}
                      className="flex min-h-11 items-center justify-center rounded-xl bg-red-50 px-3 text-red-500 font-bold hover:bg-red-100"
                      title="Supprimer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Fenêtre de vente propre à ce tarif : c'est ce qui permet un early bird qui
                      ferme avant les autres, ou un pass qui n'ouvre qu'à une date donnée.
                      Laisser vide = en vente dès l'approbation et jusqu'à l'événement. */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Ouverture des ventes (option.)</span>
                      <input
                        type="datetime-local"
                        value={tier.salesStart}
                        onChange={(e) => {
                          const newTiers = [...ticketTypes];
                          newTiers[idx].salesStart = e.target.value;
                          setTicketTypes(newTiers);
                        }}
                        className="w-full min-w-0 rounded-xl border border-gray-200 py-2.5 px-3 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Clôture des ventes (option.)</span>
                      <input
                        type="datetime-local"
                        value={tier.salesEnd}
                        onChange={(e) => {
                          const newTiers = [...ticketTypes];
                          newTiers[idx].salesEnd = e.target.value;
                          setTicketTypes(newTiers);
                        }}
                        className="w-full min-w-0 rounded-xl border border-gray-200 py-2.5 px-3 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                      />
                    </label>
                  </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTicketTypes([...ticketTypes, { name: '', price: '', total: '', salesStart: '', salesEnd: '' }])}
                  className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center mt-2"
                >
                  <Plus className="w-3 h-3 mr-1" /> Ajouter un type de billet
                </button>
              </div>
              <p className="text-[10px] text-gray-400">
                Prix laissé vide = le prix de base ci-dessus. Saisissez 0 pour un billet réellement gratuit.
              </p>
              {tarifsGratuits.length > 0 && (
                <p className="rounded-lg bg-amber-50 p-2 text-[11px] font-semibold text-amber-700" id="create-free-tier-warning">
                  {tarifsGratuits.join(", ")} {tarifsGratuits.length > 1 ? "sont gratuits" : "est gratuit"} : ces billets
                  seront délivrés sans paiement.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Nombre total de places (Inventory)</label>
              <input
                type="number"
                required
                min="10"
                placeholder="Ex : 500"
                value={totalTickets}
                onChange={(e) => setTotalTickets(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
              />
            </div>

            <PassDesignEditor
              value={passDesign}
              onChange={setPassDesign}
              onError={setFormError}
              idPrefix="create"
            />

            <div className="space-y-2 rounded-xl border border-gray-200 p-4">
              <label className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={scheduledOnsale}
                  onChange={(e) => setScheduledOnsale(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-100"
                />
                Mise en vente programmée à heure fixe
              </label>
              <p className="text-[11px] text-gray-400">
                À cocher uniquement si l'ouverture des ventes est annoncée à une heure précise et
                que vous attendez une ruée dès la première seconde : la file d'attente démarre alors
                immédiatement. Dans tous les autres cas, laissez décoché — elle s'active toute seule
                si l'affluence le justifie, et reste invisible sinon.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Lieu (Salle, Ville)</label>
              <input
                type="text"
                required
                placeholder="Ex : Palais de la Culture, Treichville, Abidjan"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Catégorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 text-gray-700"
              >
                {categories.map((cat) => (
                  <option key={cat.slug} value={cat.slug}>{cat.label}</option>
                ))}
              </select>
            </div>

            {/* Banner Theme selector */}
            <div className="space-y-3 sm:col-span-2">
              <label className="text-xs font-bold text-gray-700">Bannière de l'Événement (Sélectionnez un modèle ou entrez un lien custom)</label>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {BANNER_TEMPLATES.map((tmpl, index) => (
                  <div
                    key={index}
                    onClick={() => {
                      setSelectedBanner(tmpl.url);
                      setCustomBannerUrl("");
                    }}
                    className={`relative cursor-pointer h-16 rounded-xl overflow-hidden border transition-all ${
                      selectedBanner === tmpl.url && customBannerUrl === ""
                        ? "border-orange-500 ring-2 ring-orange-500/30 scale-95"
                        : "border-gray-200 hover:opacity-85"
                    }`}
                  >
                    <img 
                      src={tmpl.url} 
                      alt="" 
                      className="h-full w-full object-cover" 
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-1 font-semibold text-[9px] text-white text-center">
                      {tmpl.name}
                    </div>
                  </div>
                ))}
              </div>

              {/* Advanced Drag & Drop File Upload + URL Input Option */}
              <div className="space-y-3 pt-2">
                <span className="text-[10px] text-gray-400 block font-black uppercase tracking-wider">
                  Importer l'affiche de l'événement (Recommandé) :
                </span>

                <BannerUploadZone
                  value={customBannerUrl}
                  onChange={(dataUrl) => {
                    setCustomBannerUrl(dataUrl);
                    setSelectedBanner("");
                  }}
                  onError={setFormError}
                  inputId="banner-file-input"
                />

                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-gray-100"></div>
                  <span className="flex-shrink mx-3 text-[9px] text-gray-400 font-black uppercase">Ou par option alternative</span>
                  <div className="flex-grow border-t border-gray-100"></div>
                </div>

                {/* Optional input path banner URL */}
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400 block font-semibold uppercase">Coller le lien/URL public d'une affiche externe :</span>
                  <div className="relative">
                    <ImageIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="url"
                      placeholder="https://images.unsplash.com/photo-..."
                      value={customBannerUrl.startsWith("data:image") ? "" : customBannerUrl}
                      onChange={(e) => {
                        setCustomBannerUrl(e.target.value);
                        setSelectedBanner("");
                      }}
                      className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Form CTA active submissions */}
          <div className="border-t border-gray-100 pt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end sm:space-x-3 sm:gap-0">
            <button
              type="button"
              onClick={() => setSubTab("dashboard")}
              className="w-full rounded-xl px-5 py-3 text-xs font-bold text-gray-500 hover:text-gray-700 transition sm:w-auto"
            >
              Annuler
            </button>
            <button
              type="submit"
              id="submit-create-event-btn"
              disabled={submitting}
              className="w-full rounded-xl bg-orange-600 px-6 py-3 text-xs font-black text-white hover:bg-orange-700 shadow-md shadow-orange-100 disabled:bg-gray-300 transition-all active:scale-95 sm:w-auto"
            >
              {submitting ? "Publication en cours..." : "Publier l'Événement"}
            </button>
          </div>
        </form>
      ) : subTab === "simulator" ? (
        /* Sandbox Simulator Layout */
        <div className="grid gap-6 lg:grid-cols-3 animate-fade-in" id="orga-simulator-panel">
          {/* Simulator Controller Column Left */}
          <div className="rounded-2xl border border-orange-200 bg-white p-5 lg:col-span-1 space-y-5 shadow-xs">
            <div className="border-b border-orange-100 pb-3">
              <h4 className="text-xs font-black text-orange-900 uppercase tracking-widest flex items-center space-x-1.5">
                <Hammer className="h-4 w-4 text-orange-600" />
                <span>Injecteur de Ventes</span>
              </h4>
              <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">Simulez instantanément l'achat de billets par de faux clients pour tester l'évolution du solde, des stocks restants et valider des tests de scan.</p>
            </div>

            {simStatusMsg && (
              <div className={`p-3 rounded-xl text-xs font-semibold border ${
                simStatusMsg.type === "success" 
                  ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
                  : "bg-red-50 text-red-800 border-red-100"
              }`}>
                {simStatusMsg.text}
              </div>
            )}

            <form onSubmit={handleSimulatePurchase} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400">Événement Cible :</label>
                <select
                  value={simSelectedEventId}
                  onChange={(e) => setSimSelectedEventId(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-3 text-xs font-semibold text-gray-800 bg-white"
                  required
                >
                  <option value="">-- Choisir un événement --</option>
                  {myEvents.map(e => (
                    <option key={e.id} value={e.id}>{e.title.slice(0, 30)}... ({e.price} F)</option>
                  ))}
                </select>
                {myEvents.length === 0 && (
                  <p className="flex items-center gap-1 text-[10px] text-red-500 font-bold mt-1">
                    <AlertCircle className="h-3 w-3" />
                    <span>Créez d'abord un événement pour tester l'injecteur.</span>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-gray-400">Quantité :</label>
                  <select
                    value={simQuantity}
                    onChange={(e) => setSimQuantity(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 p-3 text-xs bg-white text-gray-800"
                  >
                    {[1, 2, 3, 5, 10].map(q => (
                      <option key={q} value={q}>{q} ticket(s)</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-gray-400">Catégorie :</label>
                  <select
                    value={simTier}
                    onChange={(e) => setSimTier(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 p-3 text-xs bg-white text-gray-800 font-bold"
                  >
                    {(() => {
                      const simEvent = myEvents.find(e => e.id === simSelectedEventId);
                      const tierOptions = simEvent?.ticketTypes && simEvent.ticketTypes.length > 0
                        ? simEvent.ticketTypes
                        : [{ name: "Standard", price: simEvent?.price ?? 0 }];
                      // Un tarif hors de sa fenêtre de vente reste proposé — l'injecteur sert
                      // aussi à vérifier qu'il est bien refusé — mais annoncé comme tel.
                      return tierOptions.map((t) => {
                        const fenetre = formatSaleWindowLabel(t);
                        return (
                          <option key={t.name} value={t.name.toLowerCase()}>
                            {t.name} ({t.price.toLocaleString("fr-FR")} F){fenetre ? ` — ${fenetre}` : ""}
                          </option>
                        );
                      });
                    })()}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400">Nom du spectateur :</label>
                <input
                  type="text"
                  required
                  value={simBuyerName}
                  onChange={(e) => setSimBuyerName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-3 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400">Email Facture :</label>
                <input
                  type="email"
                  required
                  value={simBuyerEmail}
                  onChange={(e) => setSimBuyerEmail(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-3 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400">Canal de Règlement :</label>
                <select
                  value={simPaymentMethod}
                  onChange={(e) => setSimPaymentMethod(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 p-3 text-xs bg-white"
                >
                  <option value="orange_money">Orange Money (CI)</option>
                  <option value="mtn_momo">MTN Mobile Money</option>
                  <option value="moov_money">Moov Flooz</option>
                  <option value="wave">Wave Mobile</option>
                  <option value="card">Carte bancaire (Visa/Mastercard)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={simulatingCheckout || !simSelectedEventId}
                className="w-full rounded-xl bg-orange-600 hover:bg-orange-700 text-white py-3.5 px-4 text-xs font-black transition-all shadow-md shadow-orange-100 disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center space-x-1"
              >
                {simulatingCheckout ? (
                  <span>Achat en cours...</span>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Lancer la Simulation d'Achat</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Sandbox Scans Columns Right */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-gray-100 pb-3">
              <div>
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center space-x-1">
                  <span>Guichet de Validation Mobile</span>
                </h4>
                <p className="text-[10px] text-gray-400 mt-1">Liste des billets validables. Simulez l'action de scanner le billet QR central d'un client au point d'entrée.</p>
              </div>
              <button 
                onClick={fetchSimulatedTickets}
                className="inline-flex items-center space-x-1.5 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 text-[10px] font-bold text-gray-600 active:scale-95"
                title="Actualiser la liste"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Actualiser</span>
              </button>
            </div>

            {loadingSimTickets ? (
              <div className="py-12 text-center text-xs text-gray-400 font-bold">Actualisation du registre...</div>
            ) : simulatedTickets.length === 0 ? (
              <div className="py-12 text-center rounded-2xl bg-gray-50 border border-dashed border-gray-200">
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Aucun billet émis pour vos événements</p>
                <p className="text-[10px] text-gray-400 mt-1 max-w-xs mx-auto">Veuillez utiliser l'injecteur de gauche pour créer des pass d'achats simulés de démonstration.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[450px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-black uppercase text-[8px] tracking-wider">
                      <th className="pb-2">Billet Réf</th>
                      <th className="pb-2">Événement</th>
                      <th className="pb-2">Acheteur / Type</th>
                      <th className="pb-2">Statut Entrée</th>
                      <th className="pb-2 text-center">Simulation Scan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {simulatedTickets.map((tkt: any) => (
                      <tr key={tkt.id} className="hover:bg-gray-50/50">
                        <td className="py-3 font-mono font-bold text-[10px]">
                          <span className="block text-gray-950 font-black">{tkt.transactionRef}</span>
                          <span className="block text-[8px] text-gray-400">{tkt.id}</span>
                        </td>
                        <td className="py-3">
                          <span className="block font-black text-gray-950 truncate max-w-[110px]" title={tkt.eventTitle}>
                            {tkt.eventTitle}
                          </span>
                          <span className="block text-[8px] text-gray-400">{new Date(tkt.purchaseDate).toLocaleDateString("fr-FR")}</span>
                        </td>
                        <td className="py-3 leading-tight">
                          <span className="block font-bold text-gray-950">{tkt.buyerName || "Inconnu"}</span>
                          <span className={`inline-flex px-1.5 rounded text-[8px] mt-0.5 font-black uppercase ${
                            isVipTier(tkt.tier) ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                          }`}>
                            {formatTierLabel(tkt.tier)}
                          </span>
                        </td>
                        <td className="py-3">
                          {tkt.scanned ? (
                            <span className="inline-flex items-center space-x-1 rounded-full bg-red-100 text-red-800 px-2.5 py-0.5 text-[8px] font-black uppercase tracking-wider">
                              <span>Déjà Validé</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 rounded-full bg-green-100 text-green-800 px-2.5 py-0.5 text-[8px] font-black uppercase tracking-wider">
                              <span>Actif</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-center">
                          <button
                            onClick={() => handleSimulateScan(tkt.qrCodeData)}
                            className={`rounded-xl px-2.5 py-1.5 text-[9px] font-extrabold transition-all active:scale-95 border ${
                              tkt.scanned
                                ? "bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed hover:bg-gray-100"
                                : "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200"
                            }`}
                          >
                            {tkt.scanned ? "Re-scanner" : "Simuler Scan"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* OVERLAY EDIT EVENT MODAL */}
      {editingEvent && (
        <ResponsiveSheet
          onClose={() => setEditingEvent(null)}
          panelClassName="max-w-2xl border border-gray-100 max-h-[90vh] overflow-y-auto p-6 space-y-6"
        >
            <button
              onClick={() => setEditingEvent(null)}
              className="absolute top-10 right-4 sm:top-4 h-8 w-8 rounded-full border border-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition"
              title="Fermer"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="border-b border-gray-50 pb-4">
              <h3 className="text-base font-black text-gray-900 flex items-center space-x-1">
                <SlidersHorizontal className="h-5 w-5 text-orange-600" />
                <span>Modifier l'événement : {editingEvent.title}</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5 font-medium">Ajustez les paramètres de votre événement. Les modifications se synchroniseront avec les ventes actifs.</p>
            </div>

            {editError && (
              <div className="rounded-lg bg-red-50 p-3.5 text-xs font-semibold text-red-600 border border-red-100">
                {editError}
              </div>
            )}

            <form onSubmit={handleUpdateEvent} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-bold text-gray-700">Titre de l'événement</label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none focus:border-orange-500"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-bold text-gray-700">Description</label>
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none focus:border-orange-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Date</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none text-gray-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Heure</label>
                  <input
                    type="time"
                    required
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none text-gray-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">
                    Date de fin <span className="font-semibold text-gray-400">(facultatif)</span>
                  </label>
                  <input
                    type="date"
                    min={editDate || undefined}
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none text-gray-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">
                    Heure de fin <span className="font-semibold text-gray-400">(facultatif)</span>
                  </label>
                  <input
                    type="time"
                    value={editEndTime}
                    onChange={(e) => {
                      setEditEndTime(e.target.value);
                      if (e.target.value && !editEndDate) setEditEndDate(editDate);
                    }}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none text-gray-700"
                  />
                </div>

                <p className="sm:col-span-2 -mt-1 text-[11px] font-medium text-gray-500">
                  Les billets cessent d'être scannables {EVENT_SCAN_GRACE_HOURS} h après la fin.
                  Sans fin renseignée, l'événement est considéré comme durant {EVENT_DEFAULT_DURATION_HOURS} h.
                </p>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Prix de base (XOF)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none focus:border-orange-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Types de billets &amp; places</label>
                  <p className="text-[10px] font-semibold leading-relaxed text-gray-400">
                    Un type de billet déjà vendu ne peut plus être renommé ni supprimé : les billets
                    émis y sont rattachés par son nom. Créez plutôt un nouveau type à côté.
                  </p>
                  <div className="grid grid-cols-3 gap-1 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">
                    <span>Catégorie</span><span>Prix (XOF)</span><span>Places</span>
                  </div>
                  <div className="space-y-2">
                    {editTicketTypes.map((tier, idx) => (
                      <div key={idx} className="space-y-2 rounded-2xl border border-gray-100 p-2">
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          placeholder="Ex: VIP"
                          value={tier.name}
                          onChange={(e) => {
                            const t = [...editTicketTypes];
                            t[idx].name = e.target.value;
                            setEditTicketTypes(t);
                          }}
                          className="flex-1 rounded-xl border border-gray-200 py-2.5 px-3 text-xs outline-none focus:border-orange-500"
                        />
                        <input
                          type="number"
                          min="0"
                          step="500"
                          placeholder="15000"
                          value={tier.price}
                          onChange={(e) => {
                            const t = [...editTicketTypes];
                            t[idx].price = e.target.value;
                            setEditTicketTypes(t);
                          }}
                          className="flex-1 rounded-xl border border-gray-200 py-2.5 px-3 text-xs outline-none focus:border-orange-500"
                        />
                        <input
                          type="number"
                          min="0"
                          placeholder="100"
                          value={tier.total}
                          onChange={(e) => {
                            const t = [...editTicketTypes];
                            t[idx].total = e.target.value;
                            setEditTicketTypes(t);
                          }}
                          className="flex-1 rounded-xl border border-gray-200 py-2.5 px-3 text-xs outline-none focus:border-orange-500"
                        />
                        <button
                          type="button"
                          onClick={() => setEditTicketTypes(editTicketTypes.filter((_, i) => i !== idx))}
                          className="px-2 rounded-xl bg-red-50 text-red-500 font-bold hover:bg-red-100"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="space-y-1">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Ouverture des ventes</span>
                          <input
                            type="datetime-local"
                            value={tier.salesStart}
                            onChange={(e) => {
                              const t = [...editTicketTypes];
                              t[idx].salesStart = e.target.value;
                              setEditTicketTypes(t);
                            }}
                            className="w-full rounded-xl border border-gray-200 py-2.5 px-3 text-xs outline-none focus:border-orange-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Clôture des ventes</span>
                          <input
                            type="datetime-local"
                            value={tier.salesEnd}
                            onChange={(e) => {
                              const t = [...editTicketTypes];
                              t[idx].salesEnd = e.target.value;
                              setEditTicketTypes(t);
                            }}
                            className="w-full rounded-xl border border-gray-200 py-2.5 px-3 text-xs outline-none focus:border-orange-500"
                          />
                        </label>
                      </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setEditTicketTypes([...editTicketTypes, { name: '', price: '', total: '', salesStart: '', salesEnd: '' }])}
                      className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center mt-1"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Ajouter un type
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    Prix laissé vide = le prix de base ci-dessus. Saisissez 0 pour un billet réellement gratuit.
                  </p>
                  {tarifsGratuitsEdition.length > 0 && (
                    <p className="rounded-lg bg-amber-50 p-2 text-[11px] font-semibold text-amber-700" id="edit-free-tier-warning">
                      {tarifsGratuitsEdition.join(", ")} {tarifsGratuitsEdition.length > 1 ? "sont gratuits" : "est gratuit"} :
                      ces billets seront délivrés sans paiement.
                    </p>
                  )}
                </div>

                {editPassDesignLoading ? (
                  <div className="rounded-2xl border border-gray-200 p-4 text-[11px] font-semibold text-gray-400">
                    Chargement de l'habillage du pass…
                  </div>
                ) : (
                  <PassDesignEditor
                    value={editPassDesign}
                    onChange={setEditPassDesign}
                    onError={setEditError}
                    idPrefix="edit"
                  />
                )}

                <div className="space-y-2 rounded-xl border border-gray-200 p-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-700">
                    <input
                      type="checkbox"
                      checked={editScheduledOnsale}
                      onChange={(e) => setEditScheduledOnsale(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-100"
                    />
                    Mise en vente programmée à heure fixe
                  </label>
                  <p className="text-[11px] text-gray-400">
                    Fait démarrer la file d'attente dès l'ouverture. Inutile autrement : elle s'active
                    d'elle-même si l'affluence le justifie.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Lieu</label>
                  <input
                    type="text"
                    required
                    value={editVenue}
                    onChange={(e) => setEditVenue(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none focus:border-orange-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Catégorie</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 px-4 text-xs outline-none text-gray-700"
                  >
                    {categories.map((cat) => (
                      <option key={cat.slug} value={cat.slug}>{cat.label}</option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2 space-y-2">
                  <label className="text-xs font-bold text-gray-700">Affiche de l'événement</label>

                  <BannerUploadZone
                    value={editCustomBannerUrl}
                    onChange={(dataUrl) => {
                      setEditCustomBannerUrl(dataUrl);
                      setEditSelectedBanner("");
                    }}
                    onError={setEditError}
                    inputId="edit-banner-file-input"
                  />

                  <div className="relative flex py-1 items-center">
                    <div className="flex-grow border-t border-gray-100"></div>
                    <span className="flex-shrink mx-3 text-[9px] text-gray-400 font-black uppercase">Ou choisir un visuel</span>
                    <div className="flex-grow border-t border-gray-100"></div>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {BANNER_TEMPLATES.map((tmpl, index) => (
                      <img
                        key={index}
                        src={tmpl.url}
                        alt=""
                        onClick={() => {
                          setEditSelectedBanner(tmpl.url);
                          setEditCustomBannerUrl("");
                        }}
                        className={`relative cursor-pointer h-12 rounded-xl object-cover border transition-all ${
                          editSelectedBanner === tmpl.url && editCustomBannerUrl === ""
                            ? "border-orange-500 ring-2 ring-orange-400/30 scale-95"
                            : "border-gray-200"
                        }`}
                        referrerPolicy="no-referrer"
                      />
                    ))}
                  </div>

                  <input
                    type="url"
                    placeholder="Ou lien URL vers image personnalisée..."
                    /* Une affiche importée est une data:image/... de plusieurs dizaines de
                       milliers de caractères : l'afficher ici remplissait le champ de base64
                       illisible. La zone d'import ci-dessus en montre l'aperçu. */
                    value={editCustomBannerUrl.startsWith("data:image") ? "" : editCustomBannerUrl}
                    onChange={(e) => {
                      setEditCustomBannerUrl(e.target.value);
                      setEditSelectedBanner("");
                    }}
                    className="w-full rounded-xl border border-gray-200 py-2 px-3 text-xs outline-none mt-2"
                  />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingEvent(null)}
                  className="rounded-xl px-4 py-2 text-xs font-bold text-gray-400 hover:text-gray-600"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="rounded-xl bg-orange-600 text-white px-5 py-2.5 text-xs font-black transition shadow-md disabled:bg-gray-200"
                >
                  {editSubmitting ? "Enregistrement..." : "Sauvegarder les modifications"}
                </button>
              </div>
            </form>
        </ResponsiveSheet>
      )}

      {/* Payouts subtab */}
      {subTab === "payouts" && (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <h3 className="text-sm font-black text-gray-900 border-b border-gray-100 pb-3 mb-4">Solde & Retrait</h3>
              <div className="mb-6">
                <span className="block text-[10px] uppercase font-bold text-gray-400">Solde Net Disponible (XOF)</span>
                <span className="text-3xl font-black text-gray-900">{stats?.totalRevenue ? Number(stats.totalRevenue).toLocaleString("fr-FR") : 0} F</span>
              </div>
              
              <form onSubmit={handleRequestPayout} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-700">Montant à retirer (XOF)</label>
                  <input
                    type="number"
                    max={stats?.totalRevenue || 0}
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    required
                    className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-xs"
                    placeholder="Ex: 50000"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700">Moyen de réception</label>
                  <select
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value)}
                    className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white text-gray-700"
                  >
                    <option value="Wave">Wave</option>
                    <option value="Orange Money">Orange Money</option>
                    <option value="MTN MoMo">MTN MoMo</option>
                    <option value="Virement Bancaire">Virement Bancaire</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700">Détails du compte (Numéro / IBAN)</label>
                  <input
                    type="text"
                    value={payoutDetails}
                    onChange={(e) => setPayoutDetails(e.target.value)}
                    required
                    className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-xs"
                    placeholder="Numéro ou détails..."
                  />
                </div>
                <button
                  type="submit"
                  disabled={submittingPayout || !payoutAmount || Number(payoutAmount) <= 0 || Number(payoutAmount) > (stats?.totalRevenue || 0)}
                  className="w-full py-2.5 rounded-xl bg-orange-600 text-white font-black text-xs disabled:bg-gray-300 transition-all"
                >
                  {submittingPayout ? "Demande en cours..." : "Demander un retrait"}
                </button>
              </form>
            </div>
            
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm overflow-hidden flex flex-col">
              <h3 className="text-sm font-black text-gray-900 border-b border-gray-100 pb-3 mb-4 shrink-0">Historique des Retraits</h3>
              <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin">
                <div className="space-y-3">
                  {payouts.map((p: any) => (
                    <div key={p.id} className="p-3 border border-gray-100 rounded-xl flex justify-between items-center text-xs">
                      <div>
                        <span className="font-bold block text-gray-900">{Number(p.amount).toLocaleString("fr-FR")} XOF</span>
                        <span className="text-[9px] text-gray-400 font-mono">{new Date(p.requestDate).toLocaleString("fr-FR")}</span>
                      </div>
                      <div className="text-right">
                        {p.status === "pending" ? (
                          <span className="px-2 py-1 bg-amber-50 text-amber-600 font-bold uppercase rounded text-[9px]">En attente</span>
                        ) : p.status === "completed" ? (
                          <span className="px-2 py-1 bg-emerald-50 text-emerald-600 font-bold uppercase rounded text-[9px]">Traité</span>
                        ) : (
                          <span className="px-2 py-1 bg-red-50 text-red-600 font-bold uppercase rounded text-[9px]">Rejeté</span>
                        )}
                        <span className="block text-[9px] uppercase font-bold text-gray-500 mt-1">{p.method}</span>
                      </div>
                    </div>
                  ))}
                  {payouts.length === 0 && (
                     <p className="text-gray-400 text-center py-6">Aucun retrait.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === "invoices" && (
        <div className="space-y-4" id="orga-invoices-view">
          <p className="text-xs text-gray-500">
            Un relevé est généré automatiquement chaque mois où vous avez des ventes confirmées — aucune saisie
            manuelle. Téléchargez-le en PDF pour votre comptabilité.
          </p>
          {(() => {
            const statements = groupMonthlyStatements(stats?.tickets || [], stats?.commissionRate ?? 0.06);
            const commissionRatePercent = Math.round((stats?.commissionRate ?? 0.06) * 100);
            return statements.length > 0 ? (
              <div className="space-y-3">
                {statements.map((s) => (
                  <div
                    key={s.key}
                    id={`invoice-row-${s.key}`}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900">{s.label}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {s.tickets.length} vente{s.tickets.length > 1 ? "s" : ""} · Brut {s.grossAmount.toLocaleString("fr-FR")} FCFA
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-black text-orange-600">{s.netAmount.toLocaleString("fr-FR")} FCFA net</span>
                      <button
                        onClick={() => printHtmlDocument(`Relevé ${s.label}`, buildOrganizerInvoiceHtml(s, user.name, commissionRatePercent))}
                        className="flex items-center space-x-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>PDF</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-gray-100 py-16 text-center">
                <Receipt className="mx-auto h-12 w-12 text-gray-300" />
                <h4 className="mt-4 text-base font-bold text-gray-900">Aucun relevé pour le moment</h4>
                <p className="mt-2 text-xs text-gray-500">Un relevé apparaîtra dès votre premier mois avec des ventes confirmées.</p>
              </div>
            );
          })()}
        </div>
      )}

    </div>
  );
}
