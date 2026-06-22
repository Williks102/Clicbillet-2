import React, { useState, useEffect } from "react";
import { Plus, LayoutDashboard, Calendar, MapPin, Tag, TrendingUp, Users, DollarSign, ListCollapse, Image as ImageIcon, Sparkles, Check, Upload, SlidersHorizontal, RefreshCw, Play, Hammer, X } from "lucide-react";
import { Event, User, SalesStatus } from "../types";
import { authFetch, TokenRefreshHandler } from "../lib/apiClient";
import ResponsiveSheet from "./ResponsiveSheet";

interface OrganizerDashboardProps {
  user: User;
  events: Event[];
  onEventCreated: () => void;
  setActiveTab: (tab: string) => void;
  onTokenRefresh: TokenRefreshHandler;
}

const CATEGORIES = ["Concert", "Festivals", "Théâtre & Humour", "Sport"];

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

export default function OrganizerDashboard({ user, events, onEventCreated, setActiveTab, onTokenRefresh }: OrganizerDashboardProps) {
  const [subTab, setSubTab] = useState<"dashboard" | "create" | "simulator" | "payouts">("dashboard");
  const [stats, setStats] = useState<SalesStatus | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Form Fields for Creation
  const [title, setTitle] = useState("");

  // ... (keeping standard hooks)
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [price, setPrice] = useState("");
  const [ticketTypes, setTicketTypes] = useState<{name: string; price: string}[]>([{ name: 'Standard', price: '' }]);
  const [venue, setVenue] = useState("");
  const [category, setCategory] = useState("Concert");
  const [totalTickets, setTotalTickets] = useState("");
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [waitingRoomCapacity, setWaitingRoomCapacity] = useState("50");
  const [selectedBanner, setSelectedBanner] = useState(BANNER_TEMPLATES[0].url);
  const [customBannerUrl, setCustomBannerUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Event Editing States
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editTicketTypes, setEditTicketTypes] = useState<{name: string; price: string}[]>([]);
  const [editVenue, setEditVenue] = useState("");
  const [editCategory, setEditCategory] = useState("Concert");
  const [editTotalTickets, setEditTotalTickets] = useState("");
  const [editWaitingRoomEnabled, setEditWaitingRoomEnabled] = useState(false);
  const [editWaitingRoomCapacity, setEditWaitingRoomCapacity] = useState("50");
  const [editSelectedBanner, setEditSelectedBanner] = useState("");
  const [editCustomBannerUrl, setEditCustomBannerUrl] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Sandbox Simulator States
  const [simSelectedEventId, setSimSelectedEventId] = useState("");
  const [simQuantity, setSimQuantity] = useState("1");
  const [simTier, setSimTier] = useState<"standard" | "vip">("standard");
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

  // Auto pre-fill Simulator Selected Event state
  useEffect(() => {
    const myEvts = events.filter(e => e.organizerId === user.id);
    if (myEvts.length > 0 && !simSelectedEventId) {
      setSimSelectedEventId(myEvts[0].id);
    }
  }, [events, user.id]);

  // Fetch simulated purchased tickets list for manual scan verification
  async function fetchSimulatedTickets() {
    setLoadingSimTickets(true);
    try {
      const response = await authFetch(`/api/organizer/stats?organizerId=${user.id}`, {}, user, onTokenRefresh);
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
        }, user, onTokenRefresh);
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

    function openEdit(evt: Event) {
      setEditingEvent(evt);
      setEditTitle(evt.title);
    setEditDescription(evt.description);
    setEditDate(evt.date);
    setEditTime(evt.time);
    setEditPrice(String(evt.price));
    setEditVenue(evt.venue);
    setEditCategory(evt.category);
    setEditTotalTickets(String(evt.totalTickets));
    setEditWaitingRoomEnabled(Boolean(evt.waitingRoomEnabled));
    setEditWaitingRoomCapacity(String(evt.waitingRoomCapacity || 50));
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

    const payload = {
      title: editTitle,
      description: editDescription,
      date: editDate,
      time: editTime,
      price: Number(editPrice),
      venue: editVenue,
      category: editCategory,
      banner: bannerPath,
      totalTickets: Number(editTotalTickets),
      organizerId: user.id,
      waitingRoomEnabled: editWaitingRoomEnabled,
      waitingRoomCapacity: Number(editWaitingRoomCapacity) || 50
    };

    try {
      const response = await authFetch(`/api/events/${editingEvent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, user, onTokenRefresh);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Une erreur est survenue lors de la mise à jour.");
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
      tier: simTier,
      quantity: Number(simQuantity),
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
      }, user, onTokenRefresh);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Échec de simuler le checkout.");
      }

      setSimStatusMsg({
        type: "success",
        text: `Achat simulé avec succès ! Billet #${data.ticket.id} enregistré. Ticket généré sous la réf ${data.ticket.transactionRef}`
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
      }, user, onTokenRefresh);
      const data = await response.json();
      if (!response.ok || data.error) {
        alert(data.error || "Erreur de validation de scan.");
      } else {
        if (data.alreadyScanned) {
          alert(`⚠️ Alerte Sécurité : Ce billet a déjà été validé à : ${new Date(data.scannedAt).toLocaleTimeString("fr-FR")}`);
        } else {
          alert(`✅ Validation Réussie ! Entrée autorisée pour ${data.ticket.buyerName} (${data.ticket.tier.toUpperCase()})`);
        }
      }
      fetchSimulatedTickets();
    } catch (e: any) {
      alert("Impossible de simuler le scanner central.");
    }
  }

  function handleImageFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setFormError("Veuillez sélectionner un fichier image (JPG, PNG, GIF, WEBP).");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFormError("La taille de l'image ne doit pas dépasser 4 Mo.");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        setCustomBannerUrl(reader.result);
        setSelectedBanner("");
      }
    };
    reader.readAsDataURL(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handleImageFile(file);
    }
  }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleImageFile(file);
    }
  }

  // Fetch sales report stats from backend API
  async function fetchStats() {
    try {
      const [response, payoutRes] = await Promise.all([
        authFetch(`/api/organizer/stats?organizerId=${user.id}`, {}, user, onTokenRefresh),
        authFetch(`/api/organizer/payouts?organizerId=${user.id}`, {}, user, onTokenRefresh)
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
      }, user, onTokenRefresh);
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

    const payload = {
      title,
      description,
      date,
      time,
      price: Number(price),
      ticketTypes: ticketTypes.filter(t => t.name.trim() !== "").map(t => ({ name: t.name, price: Number(t.price) })),
      venue,
      category,
      banner: bannerPath,
      totalTickets: Number(totalTickets),
      organizerId: user.id,
      organizerName: user.name,
      waitingRoomEnabled,
      waitingRoomCapacity: Number(waitingRoomCapacity) || 50
    };

    try {
      const response = await authFetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, user, onTokenRefresh);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Une erreur est survenue.");
      }

      // Success
      setFormSuccess(true);
      onEventCreated(); // refresh data
      
      // Clear fields
      setTitle("");
      setDescription("");
      setDate("");
      setTime("");
      setPrice("");
      setTicketTypes([{ name: 'Standard', price: '' }]);
      setVenue("");
      setTotalTickets("");
      setWaitingRoomEnabled(false);
      setWaitingRoomCapacity("50");
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

  return (
    <div className="space-y-8 py-6" id="organizer-dashboard-wrapper">
      
      {/* Header and Toggle Navigation */}
      <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-xl font-black text-gray-900 flex items-center space-x-1">
            <LayoutDashboard className="h-5 w-5 text-orange-600" />
            <span>Espace Organisateur : {user.name}</span>
          </h2>
          <p className="mt-1 text-xs text-gray-500 font-semibold uppercase tracking-wider">
            Tableau de Bord & Création d'événements
          </p>
        </div>

        {/* Dash selector pills */}
        <div className="flex flex-wrap gap-2">
          <button
            id="orga-dashboard-view-tab"
            onClick={() => setSubTab("dashboard")}
            className={`rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
              subTab === "dashboard"
                ? "bg-slate-950 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-150"
            }`}
          >
            Suivi des Ventes
          </button>
          <button
            id="orga-create-view-tab"
            onClick={() => setSubTab("create")}
            className={`flex items-center space-x-1 rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
              subTab === "create"
                ? "bg-slate-950 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-150"
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
            <span>🧪 Simulateur Sandbox</span>
          </button>
          <button
            id="orga-payouts-view-tab"
            onClick={() => setSubTab("payouts")}
            className={`flex items-center space-x-1.5 rounded-xl px-4 py-2.5 text-xs font-black transition-all active:scale-95 ${
              subTab === "payouts"
                ? "bg-slate-950 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-150"
            }`}
          >
            <DollarSign className="h-4 w-4" />
            <span>Retraits & Soldes</span>
          </button>
        </div>
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
                  <span>Brut total : {((stats as any).totalGrossRevenue || 0).toLocaleString("fr-FR")} F</span>
                  <span className="text-orange-600">Com. Plateforme (-10%) : -{((stats as any).totalCommission || 0).toLocaleString("fr-FR")} F</span>
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
                  {loadingStats ? "Chargement..." : `${stats?.ticketsSold || 0} tickets`}
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
            {/* Custom SVG line Chart */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:col-span-3">
              <div className="flex items-center justify-between pb-4 border-b border-gray-50 mb-4">
                <h4 className="text-sm font-black text-gray-900 flex items-center space-x-1.5">
                  <TrendingUp className="h-4 w-4 text-orange-600" />
                  <span>Performance Hebdomadaire des ventes (XOF)</span>
                </h4>
              </div>

              {/* Handcrafted animated line graphs */}
              <div className="relative h-48 w-full mt-4 flex items-end">
                <svg className="h-full w-full" viewBox="0 0 400 150">
                  {/* Grid Lines */}
                  <line x1="10" y1="30" x2="390" y2="30" stroke="#f3f4f6" strokeWidth="1" />
                  <line x1="10" y1="75" x2="390" y2="75" stroke="#f3f4f6" strokeWidth="1" />
                  <line x1="10" y1="120" x2="390" y2="120" stroke="#f3f4f6" strokeWidth="1" />

                  {/* Bezier Line Chart for simulated sales distribution */}
                  <path
                    d="M 20,130 C 50,110 80,120 110,80 C 140,40 170,95 200,60 C 230,25 260,115 290,40 C 320,-10 350,55 380,15"
                    fill="none"
                    stroke="url(#orange-gradient)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    className="animate-pulse"
                  />

                  {/* Interactive node indicator points */}
                  <circle cx="110" cy="80" r="5" fill="#f97316" stroke="#ffffff" strokeWidth="1.5" />
                  <circle cx="200" cy="60" r="5" fill="#f97316" stroke="#ffffff" strokeWidth="1.5" />
                  <circle cx="290" cy="40" r="5" fill="#f97316" stroke="#ffffff" strokeWidth="1.5" />
                  <circle cx="380" cy="15" r="5.5" fill="#f97316" stroke="#ffffff" strokeWidth="1.5" />

                  {/* SVG gradients */}
                  <defs>
                    <linearGradient id="orange-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#f3f4f6" />
                      <stop offset="50%" stopColor="#f97316" />
                      <stop offset="100%" stopColor="#fbbf24" />
                    </linearGradient>
                  </defs>
                </svg>

                {/* Simulated tooltips floating inside line graph containers */}
                <div className="absolute top-2 right-4 bg-orange-600 px-2 py-0.5 rounded-md text-[9px] font-bold text-white shadow-md">
                  Ventes maximum aujourd'hui (+240%)
                </div>
              </div>
              <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono mt-3 px-2">
                <span>Lundi</span>
                <span>Mardi</span>
                <span>Mercredi</span>
                <span>Jeudi</span>
                <span>Vendredi</span>
                <span>Samedi</span>
                <span>Dimanche</span>
              </div>
            </div>

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
                        <span className="text-xs font-extrabold text-orange-650 block">+{sale.amount.toLocaleString("fr-FR")} F</span>
                        <span className="text-[9px] text-gray-400 uppercase font-mono font-semibold">
                          {sale.tier === "vip" ? "VIP" : "STD"}
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
        </div>
      ) : subTab === "create" ? (
        /* Create New Event Form Layout */
        <form onSubmit={handleCreateEvent} className="rounded-2xl border border-gray-150/70 bg-white p-6 space-y-6" id="orga-create-form-view">
          <div className="border-b border-gray-50 pb-4">
            <h3 className="text-base font-black text-gray-900 flex items-center space-x-1">
              <Sparkles className="h-4.5 w-4.5 text-orange-600" />
              <span>Publiez un Nouvel Événement</span>
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
          <div className="grid gap-5 sm:grid-cols-2">
            
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
              <label className="text-xs font-bold text-gray-700">Types de billets (Optionnel)</label>
              <div className="space-y-2">
                {ticketTypes.map((tier, idx) => (
                  <div key={idx} className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="Nom (ex: VIP, VIP+)"
                      value={tier.name}
                      onChange={(e) => {
                        const newTiers = [...ticketTypes];
                        newTiers[idx].name = e.target.value;
                        setTicketTypes(newTiers);
                      }}
                      className="w-1/2 rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                    />
                    <input
                      type="number"
                      min="0"
                      step="500"
                      placeholder="Prix (ex: 15000)"
                      value={tier.price}
                      onChange={(e) => {
                        const newTiers = [...ticketTypes];
                        newTiers[idx].price = e.target.value;
                        setTicketTypes(newTiers);
                      }}
                      className="w-1/2 rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => setTicketTypes(ticketTypes.filter((_, i) => i !== idx))}
                      className="px-3 rounded-xl bg-red-50 text-red-500 font-bold hover:bg-red-100"
                      title="Supprimer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTicketTypes([...ticketTypes, { name: '', price: '' }])}
                  className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center mt-2"
                >
                  <Plus className="w-3 h-3 mr-1" /> Ajouter un type de billet
                </button>
              </div>
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

            <div className="space-y-2 rounded-xl border border-gray-200 p-4">
              <label className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={waitingRoomEnabled}
                  onChange={(e) => setWaitingRoomEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-100"
                />
                Activer la salle d'attente virtuelle
              </label>
              <p className="text-[11px] text-gray-400">
                À activer si vous attendez un fort pic de demande : les acheteurs patientent
                dans une file avant d'accéder au paiement, pour éviter la surcharge.
              </p>
              {waitingRoomEnabled && (
                <div className="space-y-1 pt-1">
                  <label className="text-xs font-bold text-gray-700">Capacité simultanée en checkout</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Ex : 50"
                    value={waitingRoomCapacity}
                    onChange={(e) => setWaitingRoomCapacity(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                  />
                </div>
              )}
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
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                <option value="Professionnel">Professionnel</option>
              </select>
            </div>

            {/* Banner Theme selector */}
            <div className="col-span-2 space-y-3">
              <label className="text-xs font-bold text-gray-700">Bannière de l'Événement (Sélectionnez un modèle ou entrez un lien custom)</label>
              
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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

                {/* Drag-and-drop container */}
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById("banner-file-input")?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer flex flex-col items-center justify-center space-y-2 relative overflow-hidden ${
                    dragActive
                      ? "border-orange-500 bg-orange-50"
                      : customBannerUrl.startsWith("data:image")
                      ? "border-emerald-500 bg-emerald-50/20"
                      : "border-gray-200 hover:border-orange-400 hover:bg-gray-50 bg-white"
                  }`}
                >
                  <input
                    type="file"
                    id="banner-file-input"
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileChange}
                  />

                  {customBannerUrl.startsWith("data:image") ? (
                    <div className="flex flex-col items-center space-y-2">
                      <div className="relative">
                        <img
                          src={customBannerUrl}
                          alt="Prévisualisation d'affiche"
                          className="h-20 w-32 object-cover rounded-xl border border-emerald-200 shadow-sm"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomBannerUrl("");
                          }}
                          className="absolute -top-1.5 -right-1.5 bg-red-650 hover:bg-red-700 text-red-500 hover:text-red-700 bg-white border border-gray-200 h-5 w-5 rounded-full flex items-center justify-center shadow-md font-bold text-[10px]"
                          title="Effacer la photo"
                        >
                          ✕
                        </button>
                      </div>
                      <p className="text-[11px] font-black text-emerald-800">✓ Photo importée avec succès !</p>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-full bg-orange-50 p-3 text-orange-600">
                        <Upload className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-gray-800">
                          Glissez-déposez votre affiche ici, ou <span className="text-orange-600 underline">parcourez vos fichiers</span>
                        </p>
                        <p className="text-[9px] text-gray-400 mt-1 uppercase font-bold">PNG, JPG, WEBP jusqu'à 4 Mo maximum</p>
                      </div>
                    </>
                  )}
                </div>

                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-gray-100"></div>
                  <span className="flex-shrink mx-3 text-[9px] text-gray-350 font-black uppercase">Ou par option alternative</span>
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
          <div className="border-t border-gray-150 pt-5 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={() => setSubTab("dashboard")}
              className="rounded-xl px-5 py-3 text-xs font-bold text-gray-500 hover:text-gray-700 transition"
            >
              Annuler
            </button>
            <button
              type="submit"
              id="submit-create-event-btn"
              disabled={submitting}
              className="rounded-xl bg-orange-600 px-6 py-3 text-xs font-black text-white hover:bg-orange-700 shadow-md shadow-orange-100 disabled:bg-gray-300 transition-all active:scale-95"
            >
              {submitting ? "Publication en cours..." : "Publier l'Événement"}
            </button>
          </div>
        </form>
      ) : (
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
                  ? "bg-emerald-50 text-emerald-805 border-emerald-105" 
                  : "bg-red-50 text-red-850 border-red-105"
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
                  <p className="text-[10px] text-red-505 font-bold mt-1">⚠️ Créez d'abord un événement pour tester l'injecteur.</p>
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
                    onChange={(e) => setSimTier(e.target.value as any)}
                    className="w-full rounded-xl border border-gray-200 p-3 text-xs bg-white text-gray-800 font-bold"
                  >
                    <option value="standard">Standard</option>
                    <option value="vip">VIP (+10k CFA)</option>
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
          <div className="rounded-2xl border border-gray-150 bg-white p-5 lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-gray-100 pb-3">
              <div>
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center space-x-1">
                  <span>Guichet de Validation Mobile</span>
                </h4>
                <p className="text-[10px] text-gray-400 mt-1">Liste des billets validables. Simulez l'action de scanner le billet QR central d'un client au point d'entrée.</p>
              </div>
              <button 
                onClick={fetchSimulatedTickets}
                className="inline-flex items-center space-x-1.5 p-2 rounded-xl border border-gray-150 hover:bg-gray-50 text-[10px] font-bold text-gray-600 active:scale-95"
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
                            tkt.tier === "vip" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                          }`}>
                            {tkt.tier === "vip" ? "VIP" : "STD"}
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
                                ? "bg-gray-50 text-gray-400 border-gray-150 cursor-not-allowed hover:bg-gray-100"
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
      )}

      {/* OVERLAY EDIT EVENT MODAL */}
      {editingEvent && (
        <ResponsiveSheet
          onClose={() => setEditingEvent(null)}
          panelClassName="max-w-2xl border border-gray-100 max-h-[90vh] overflow-y-auto p-6 space-y-6"
        >
            <button
              onClick={() => setEditingEvent(null)}
              className="absolute top-10 right-4 sm:top-4 h-8 w-8 rounded-full border border-gray-150 flex items-center justify-center text-gray-400 hover:text-gray-650 hover:bg-gray-50 transition"
              title="Fermer"
            >
              ✕
            </button>

            <div className="border-b border-gray-50 pb-4">
              <h3 className="text-base font-black text-gray-900 flex items-center space-x-1">
                <SlidersHorizontal className="h-5 w-5 text-orange-600" />
                <span>Modifier l'événement : {editingEvent.title}</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5 font-medium">Ajustez les paramètres de votre événement. Les modifications se synchroniseront avec les ventes actifs.</p>
            </div>

            {editError && (
              <div className="rounded-lg bg-red-50 p-3.5 text-xs font-semibold text-red-650 border border-red-100">
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
                  <label className="text-xs font-bold text-gray-700">Nombre de places total</label>
                  <input
                    type="number"
                    required
                    min="10"
                    value={editTotalTickets}
                    onChange={(e) => setEditTotalTickets(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none focus:border-orange-500"
                  />
                </div>

                <div className="space-y-2 rounded-xl border border-gray-200 p-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-700">
                    <input
                      type="checkbox"
                      checked={editWaitingRoomEnabled}
                      onChange={(e) => setEditWaitingRoomEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-100"
                    />
                    Activer la salle d'attente virtuelle
                  </label>
                  {editWaitingRoomEnabled && (
                    <div className="space-y-1 pt-1">
                      <label className="text-xs font-bold text-gray-700">Capacité simultanée en checkout</label>
                      <input
                        type="number"
                        min="1"
                        value={editWaitingRoomCapacity}
                        onChange={(e) => setEditWaitingRoomCapacity(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-xs outline-none focus:border-orange-500"
                      />
                    </div>
                  )}
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
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="Professionnel">Professionnel</option>
                  </select>
                </div>

                <div className="sm:col-span-2 space-y-2">
                  <label className="text-xs font-bold text-gray-700">Modèle de Bannière ou URL</label>
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
                    value={editCustomBannerUrl}
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
                  className="rounded-xl px-4 py-2 text-xs font-bold text-gray-400 hover:text-gray-650"
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

    </div>
  );
}
