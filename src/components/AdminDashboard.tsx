import React, { useState, useEffect } from "react";
import { User, Event, Ticket } from "../types";
import {
  Building2, Users, Calendar, DollarSign, Trash2, ShieldCheck,
  Search, ShieldAlert, Sparkles, Ticket as TicketIcon, TrendingUp, Filter, Percent,
  Image as ImageIcon, RefreshCw
} from "lucide-react";
import { authFetch } from "../lib/apiClient";
import { isEventPast } from "../lib/eventStatus";
import { isVipTier, formatTierLabel } from "../lib/ticketTier";
import DashboardMobileMenu from "./DashboardMobileMenu";
import CommissionSheet from "./CommissionSheet";

interface AdminDashboardProps {
  user: User;
}

interface AdminStats {
  totalRevenue: number; // Gross Vol. Affaires
  totalPlatformCommission: number; // Part plateforme (taux effectif, cf. commissionRate)
  totalOrganizerPayout: number; // Part nette reversée aux organisateurs
  commissionRate: number;
  totalTicketsSold: number;
  totalUsers: number;
  totalEvents: number;
  users: { id: string; name: string; email: string; role: string }[];
  events: Event[];
  tickets: Ticket[];
}

type AdminSubTab = "overview" | "events" | "users" | "tickets" | "payouts" | "transactions";

const ADMIN_SUB_TABS: AdminSubTab[] = ["overview", "events", "users", "tickets", "payouts", "transactions"];

const ADMIN_SUB_TAB_LABELS: Record<AdminSubTab, string> = {
  overview: "Tableau de Bord",
  events: "Événements & Modération",
  users: "Membres & Rôles",
  tickets: "Billets Vendus",
  payouts: "Demandes de Retrait",
  transactions: "Log Transactions"
};

const ADMIN_SUB_TAB_ICONS: Record<AdminSubTab, React.ReactNode> = {
  overview: <Sparkles className="h-4 w-4" />,
  events: <Calendar className="h-4 w-4" />,
  users: <Users className="h-4 w-4" />,
  tickets: <TicketIcon className="h-4 w-4" />,
  payouts: <DollarSign className="h-4 w-4" />,
  transactions: <TrendingUp className="h-4 w-4" />
};

export default function AdminDashboard({ user }: AdminDashboardProps) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<AdminSubTab>("overview");

  // Search & Filters parameters
  const [userSearch, setUserSearch] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");

  // Maintenance ponctuelle : recompression des bannières déjà stockées en base64 brut
  // (cf. server/routes/admin.ts, POST /api/admin/compress-banners).
  const [bannerCompressLoading, setBannerCompressLoading] = useState(false);
  const [bannerCompressResult, setBannerCompressResult] = useState<{
    dryRun: boolean; processed: number; skipped: number; failed: number;
    totalBeforeMB: number; totalAfterMB: number;
    details: { id: string; title: string; beforeMB: number; afterMB: number }[];
  } | null>(null);

  async function handleCompressBanners(apply: boolean) {
    if (apply && !window.confirm("Recompresser et remplacer les bannières existantes ? Cette action écrase les images actuelles (qualité réduite, mêmes dimensions visuelles).")) {
      return;
    }
    setBannerCompressLoading(true);
    try {
      const res = await authFetch("/api/admin/compress-banners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec de l'opération.");
      setBannerCompressResult(data);
    } catch (err: any) {
      setError(err.message || "Échec de la recompression des bannières.");
    } finally {
      setBannerCompressLoading(false);
    }
  }

  const handleValidatePayment = async (referenceNumber: string) => {
    if (!window.confirm("Valider manuellement ce paiement ? Le client recevra son ticket avec le QR code.")) {
      return;
    }

    try {
      const resp = await authFetch("/api/admin/validate-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceNumber })
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Erreur de validation manuelle");
      }
      alert(data.message || "Paiement validé avec succès");
      fetchAdminData();
    } catch (e: any) {
      alert(e.message || "Impossible de forcer la validation.");
    }
  };
  const [roleFilter, setRoleFilter] = useState("Tous");
  const [commissionSheetEvent, setCommissionSheetEvent] = useState<Event | null>(null);

  async function fetchAdminData() {
    setLoading(true);
    setError(null);
    try {
      const [response, respPayouts, respTx] = await Promise.all([
        authFetch("/api/admin/stats", {}),
        authFetch("/api/admin/payouts", {}),
        authFetch("/api/admin/transactions", {})
      ]);
      if (!response.ok) {
        throw new Error("Impossible de communiquer avec l'interface d'administration.");
      }
      const data = await response.json();
      setStats(data);

      if (respPayouts.ok) setPayouts(await respPayouts.json());
      if (respTx.ok) setTransactions(await respTx.json());
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Impossible de récupérer les statistiques d'administration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAdminData();
  }, []);

  async function handleUpdateEventStatus(id: string, status: "approved" | "rejected") {
    if (!confirm(`Confirmer le changement de statut en ${status} ?`)) return;
    try {
      const response = await authFetch(`/api/admin/events/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error("Erreur de mise à jour.");
      fetchAdminData();
    } catch (err: any) { alert(err.message); }
  }

  async function handleUpdatePayout(id: string, status: "completed" | "rejected") {
    if (!confirm(`Marquer ce retrait comme ${status} ?`)) return;
    try {
      const response = await authFetch(`/api/admin/payouts/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error("Erreur de mise à jour.");
      fetchAdminData();
    } catch (err: any) { alert(err.message); }
  }

  async function handleDeleteEvent(id: string) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cet événement de la plateforme ? Cette action est irréversible.")) return;
    try {
      const response = await authFetch(`/api/admin/events/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Erreur de suppression.");
      }
      fetchAdminData(); // Refresh metrics
    } catch (err: any) {
      alert(err.message || "Erreur lors de la suppression de l'événement.");
    }
  }

  async function handleSaveCommission(evt: Event, commissionRate: number | null) {
    const response = await authFetch(`/api/admin/events/${evt.id}/commission`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionRate })
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Erreur de mise à jour de la commission.");
    }
    setCommissionSheetEvent(null);
    fetchAdminData();
  }

  async function handleDeleteUser(id: string) {
    if (!confirm("Êtes-vous sûr de vouloir révoquer ce compte utilisateur de ClicBillet ? Cette action est irréversible.")) return;
    try {
      const response = await authFetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Erreur de révocation.");
      }
      fetchAdminData(); // Refresh metrics
    } catch (err: any) {
      alert(err.message || "Erreur lors de la révocation du compte.");
    }
  }

  const filteredUsers = stats?.users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(userSearch.toLowerCase()) || 
                          u.email.toLowerCase().includes(userSearch.toLowerCase());
    const matchesRole = roleFilter === "Tous" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  }) || [];

  const filteredEvents = stats?.events.filter(e => {
    return e.title.toLowerCase().includes(eventSearch.toLowerCase()) || 
           e.venue.toLowerCase().includes(eventSearch.toLowerCase()) ||
           e.organizerName.toLowerCase().includes(eventSearch.toLowerCase());
  }) || [];

  const filteredTickets = stats?.tickets.filter(t => {
    return t.eventTitle.toLowerCase().includes(ticketSearch.toLowerCase()) ||
           t.buyerName.toLowerCase().includes(ticketSearch.toLowerCase()) ||
           t.transactionRef.toLowerCase().includes(ticketSearch.toLowerCase());
  }) || [];

  // Fragments réutilisés entre la vue tableau (desktop) et la vue cartes (mobile) de l'onglet
  // Événements, pour ne pas dupliquer la logique de statut/actions dans les deux rendus.
  function eventStatusBadge(evt: Event) {
    const isPast = evt.status === "approved" && isEventPast(evt);
    if (evt.status === "pending") {
      return <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-md text-[10px] font-bold uppercase border border-amber-200 shrink-0">En Attente</span>;
    }
    if (evt.status === "rejected") {
      return <span className="px-2 py-1 bg-red-50 text-red-600 rounded-md text-[10px] font-bold uppercase border border-red-200 shrink-0">Rejeté</span>;
    }
    if (isPast) {
      return <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase border border-slate-200 shrink-0">Terminé</span>;
    }
    return <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-bold uppercase border border-emerald-200 shrink-0">Approuvé</span>;
  }

  function commissionButton(evt: Event) {
    return (
      <button
        onClick={() => setCommissionSheetEvent(evt)}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase border transition ${
          evt.commissionRate != null
            ? "bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100"
            : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
        }`}
        title="Définir un taux de commission négocié pour cet événement"
      >
        <Percent className="h-3 w-3" />
        {evt.commissionRate != null ? `${(evt.commissionRate * 100).toFixed(0)}%` : "Défaut"}
      </button>
    );
  }

  function eventActionButtons(evt: Event) {
    return (
      <>
        {evt.status === "pending" && (
          <>
            <button onClick={() => handleUpdateEventStatus(evt.id, "approved")} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2.5 py-1.5 text-[10px] font-bold uppercase rounded-md transition" title="Approuver">
              Valid
            </button>
            <button onClick={() => handleUpdateEventStatus(evt.id, "rejected")} className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1.5 text-[10px] font-bold uppercase rounded-md transition" title="Rejeter">
              Rejet
            </button>
          </>
        )}
        <button
          onClick={() => handleDeleteEvent(evt.id)}
          className="bg-red-50 hover:bg-red-100 text-red-600 p-1.5 rounded-md transition ml-2"
          title="Supprimer l'événement de la plateforme"
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </button>
      </>
    );
  }

  // Fragments réutilisés entre la vue tableau (desktop) et la vue cartes (mobile) de l'onglet Membres.
  function userRoleBadge(role: string) {
    return (
      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${
        role === "admin"
          ? "bg-purple-100 text-purple-800"
          : role === "organizer"
          ? "bg-orange-100 text-orange-800"
          : "bg-blue-100 text-blue-800"
      }`}>
        {role === "admin" ? "Administrateur" : role === "organizer" ? "Organisateur" : "Client / Acheteur"}
      </span>
    );
  }

  function userDeleteAction(usr: { id: string }) {
    if (usr.id === "usr-admin") {
      return <span className="text-[10px] text-gray-400 font-bold uppercase italic">Intouchable</span>;
    }
    return (
      <button
        onClick={() => handleDeleteUser(usr.id)}
        className="bg-red-50 hover:bg-red-100 text-red-600 p-2 rounded-xl transition"
        title="Révoquer le compte définitivement"
      >
        <Trash2 className="h-4 w-4 text-red-500" />
      </button>
    );
  }

  // Réutilisé entre la vue tableau (desktop) et la vue cartes (mobile) de l'onglet Billets Vendus.
  function ticketStatusAction(tkt: { id: string; paymentStatus?: string }) {
    if (tkt.paymentStatus === "pending") {
      return (
        <button onClick={() => handleValidatePayment(tkt.id)} className="bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-all shrink-0">
          Valider manuellement
        </button>
      );
    }
    return (
      <div className="inline-flex items-center space-x-1 text-green-700 bg-green-50 px-2 py-1 rounded-md shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider">Payé</span>
      </div>
    );
  }

  // Réutilisé entre la vue tableau (desktop) et la vue cartes (mobile) de l'onglet Demandes de Retrait.
  function payoutStatusAction(p: { id: string; status: string }) {
    if (p.status === "pending") {
      return (
        <div className="flex items-center justify-center space-x-2">
          <button onClick={() => handleUpdatePayout(p.id, "completed")} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2 py-1 text-[10px] font-bold rounded">Payer</button>
          <button onClick={() => handleUpdatePayout(p.id, "rejected")} className="bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1 text-[10px] font-bold rounded">Refuser</button>
        </div>
      );
    }
    if (p.status === "completed") {
      return <span className="text-emerald-500 font-bold text-[10px] uppercase">Réglé</span>;
    }
    return <span className="text-red-500 font-bold text-[10px] uppercase">Rejeté</span>;
  }

  // Réutilisé entre la vue tableau (desktop) et la vue cartes (mobile) de l'onglet Log Transactions.
  function transactionStatusBadge(status: string) {
    if (status === "success") {
      return <span className="text-emerald-500 font-bold text-[10px] uppercase">Succès</span>;
    }
    if (status === "failed") {
      return <span className="text-red-500 font-bold text-[10px] uppercase">Échec</span>;
    }
    return <span className="text-amber-500 font-bold text-[10px] uppercase">En Attente</span>;
  }

  if (loading) {
    return (
      <div className="py-24 text-center" id="admin-dashboard-loading">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
        <p className="mt-4 text-xs font-bold text-gray-500">Ouverture de la console de supervision...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8" id="admin-dashboard-container">
      {/* Sidebar Area */}
      <aside className="w-full lg:w-64 shrink-0 space-y-6">
        {/* Platform Level Header - Compacted for sidebar */}
        <section className="rounded-2xl bg-slate-900 text-white p-5 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-600/20 via-transparent to-transparent opacity-60 pointer-events-none" />
          <div className="relative z-10 flex flex-col gap-3">
            <div>
              <div className="inline-flex items-center space-x-1.5 rounded-full bg-orange-500/15 border border-orange-500/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-2">
                <ShieldCheck className="h-3 w-3" />
                <span>Supervision</span>
              </div>
              <h2 className="text-lg font-black leading-tight tracking-tight text-white">
                {user.name}
              </h2>
              <p className="mt-1 text-[10px] text-slate-400 font-medium truncate">
                {user.email}
              </p>
            </div>
          </div>
        </section>

        {/* Menu hamburger mobile : remplace la nav ci-dessous sous "lg" (style menu admin WordPress) */}
        <DashboardMobileMenu
          title="Menu Supervision"
          activeLabel={ADMIN_SUB_TAB_LABELS[activeSubTab]}
          items={ADMIN_SUB_TABS.map((tab) => ({
            key: tab,
            label: ADMIN_SUB_TAB_LABELS[tab],
            icon: ADMIN_SUB_TAB_ICONS[tab],
            active: activeSubTab === tab,
            onSelect: () => setActiveSubTab(tab)
          }))}
        />

        {/* Sidebar Navigation (desktop / large screens uniquement) */}
        <nav className="hidden lg:flex lg:flex-col gap-2">
          {ADMIN_SUB_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveSubTab(tab)}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs whitespace-nowrap font-black transition-all ${
                activeSubTab === tab
                  ? "bg-orange-50 text-orange-600 border border-orange-100 shadow-sm"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 border border-transparent"
              }`}
            >
              {ADMIN_SUB_TAB_ICONS[tab]}
              <span>{ADMIN_SUB_TAB_LABELS[tab]}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 space-y-6">
        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-600 border border-red-100 flex items-center space-x-2">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Metrics Banner cards (Only show on overview) */}
        {activeSubTab === "overview" && stats && (
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3" id="admin-kpis-grid">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Volume d'affaires Brut</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-50 text-gray-700">
                  <DollarSign className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3.5 text-xl font-black text-slate-900 font-sans tracking-tight">
                {stats.totalRevenue.toLocaleString("fr-FR")} <span className="text-xs text-slate-500">FCFA</span>
              </p>
              <p className="mt-1 text-[10px] text-gray-400 font-bold uppercase">Recettes brutes (100%)</p>
            </div>

            <div className="rounded-2xl border border-orange-100 bg-orange-50/25 p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-orange-500 text-[10px] font-black uppercase tracking-wider">Commission ClicBillet</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                  <Sparkles className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3.5 text-xl font-black text-orange-950 font-sans tracking-tight">
                {(stats.totalPlatformCommission || 0).toLocaleString("fr-FR")} <span className="text-xs text-orange-600">FCFA</span>
              </p>
              <p className="mt-1 text-[10px] text-orange-500 font-bold uppercase">Revenus Admin ({Math.round((stats.commissionRate || 0) * 100)}%)</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Reversement Organisateurs</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Building2 className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3.5 text-xl font-black text-slate-900 font-sans tracking-tight">
                {(stats.totalOrganizerPayout || 0).toLocaleString("fr-FR")} <span className="text-xs text-indigo-600">FCFA</span>
              </p>
              <p className="mt-1 text-[10px] text-gray-400 font-bold uppercase">Part Organisateur (90%)</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Billets vendus</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <TicketIcon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3.5 text-xl font-black text-slate-900 font-sans tracking-tight">
                {stats.totalTicketsSold.toLocaleString("fr-FR")}
              </p>
              <p className="mt-1 text-[10px] text-gray-400 font-bold uppercase">Réservations validées</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Utilisateurs</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Users className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3.5 text-xl font-black text-slate-900 font-sans tracking-tight">
                {stats.totalUsers.toLocaleString("fr-FR")}
              </p>
              <p className="mt-1 text-[10px] text-gray-400 font-bold uppercase">Membres enregistrés</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Événements</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <Calendar className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3.5 text-xl font-black text-slate-900 font-sans tracking-tight">
                {stats.totalEvents.toLocaleString("fr-FR")}
              </p>
              <p className="mt-1 text-[10px] text-gray-400 font-bold uppercase">Événements en ligne</p>
            </div>
          </section>
        )}

        {/* Tab Context content */}
        <section className="space-y-6">
        
        {/* TAB 1: OVERVIEW COMPACT DASHBOARD */}
        {activeSubTab === "overview" && stats && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Recent users snippet */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:col-span-1 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-50 pb-3">
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide">Inscriptions récentes</h4>
                <button 
                  onClick={() => setActiveSubTab("users")} 
                  className="text-[10px] font-extrabold text-orange-600 hover:underline"
                >
                  Voir tous
                </button>
              </div>
              <div className="space-y-3">
                {stats.users.slice(0, 6).map((usr) => (
                  <div key={usr.id} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 border border-gray-100/50">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-gray-950 truncate">{usr.name}</p>
                      <p className="text-[10px] text-gray-400 truncate font-mono">{usr.email}</p>
                    </div>
                    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase ${
                      usr.role === "admin" 
                        ? "bg-purple-100 text-purple-800" 
                        : usr.role === "organizer" 
                        ? "bg-orange-100 text-orange-800" 
                        : "bg-blue-100 text-blue-800"
                    }`}>
                      {usr.role === "admin" ? "Admin" : usr.role === "organizer" ? "Orga" : "Client"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial ledger logs list */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-50 pb-3">
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide flex items-center space-x-1.5">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  <span>Derniers règlements de billets</span>
                </h4>
                <button 
                  onClick={() => setActiveSubTab("tickets")} 
                  className="text-[10px] font-extrabold text-orange-600 hover:underline"
                >
                  Superviser les flux
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                      <th className="pb-3 pt-1">Réf / Date</th>
                      <th className="pb-3 pt-1">Acheteur</th>
                      <th className="pb-3 pt-1">Événement</th>
                      <th className="pb-3 pt-1 text-center">Quantité</th>
                      <th className="pb-3 pt-1 text-right">Montant</th>
                      <th className="pb-3 pt-1 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {stats.tickets.slice(0, 6).map((tkt) => (
                      <tr key={tkt.id} className="hover:bg-gray-50/50">
                        <td className="py-3 font-mono font-bold">
                          <span className="block text-gray-950 font-black text-xs flex items-center gap-1">
                            {tkt.paymentStatus === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" title="Paiement en attente"></span>}
                            {tkt.transactionRef}
                          </span>
                          <span className="block text-[9px] text-gray-400">{new Date(tkt.purchaseDate).toLocaleDateString("fr-FR")}</span>
                        </td>
                        <td className="py-3 font-medium text-gray-900">
                          {tkt.buyerName} <span className="block text-[9px] text-gray-400 font-mono">{tkt.buyerEmail}</span>
                        </td>
                        <td className="py-3 truncate max-w-[150px] font-bold text-gray-950" title={tkt.eventTitle}>
                          {tkt.eventTitle}
                        </td>
                        <td className="py-3 text-center font-bold text-gray-600">{tkt.quantity}</td>
                        <td className="py-3 text-right font-black text-orange-600">{tkt.pricePaid.toLocaleString("fr-FR")} F CFA</td>
                        <td className="py-3 text-center">
                          {tkt.paymentStatus === "pending" ? (
                            <button onClick={() => handleValidatePayment(tkt.id)} className="bg-amber-100 hover:bg-amber-200 text-amber-800 text-[9px] font-bold px-2 py-1 rounded">
                              Valider
                            </button>
                          ) : (
                            <span className="text-green-600 font-bold text-[10px]">Réglé</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stats.tickets.length === 0 && (
                  <p className="text-center text-xs text-gray-400 py-12 font-bold uppercase tracking-wider">Aucun flux financier détecté.</p>
                )}
              </div>
            </div>

            {/* Maintenance ponctuelle : recompression des bannières déjà en base */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:col-span-3 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-50 pb-3">
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide flex items-center space-x-1.5">
                  <ImageIcon className="h-4 w-4 text-orange-500" />
                  <span>Maintenance : bannières d'événements</span>
                </h4>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                Recompresse les bannières d'événements déjà stockées en base64 brut (photos uploadées avant
                l'optimisation automatique) — sans changement visuel, juste un fichier plus léger à charger
                pour vos visiteurs.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <button
                  onClick={() => handleCompressBanners(false)}
                  disabled={bannerCompressLoading}
                  className="flex items-center space-x-1.5 rounded-xl bg-gray-50 px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${bannerCompressLoading ? "animate-spin" : ""}`} />
                  <span>Aperçu (aucune écriture)</span>
                </button>
                <button
                  onClick={() => handleCompressBanners(true)}
                  disabled={bannerCompressLoading}
                  className="flex items-center space-x-1.5 rounded-xl bg-orange-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${bannerCompressLoading ? "animate-spin" : ""}`} />
                  <span>Appliquer</span>
                </button>
              </div>

              {bannerCompressResult && (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
                  <p className="text-xs font-bold text-gray-900">
                    {bannerCompressResult.dryRun ? "Aperçu" : "Appliqué"} — {bannerCompressResult.processed} événement(s) optimisé(s),{" "}
                    {bannerCompressResult.skipped} ignoré(s) (déjà léger/optimal), {bannerCompressResult.failed} échec(s).
                  </p>
                  {bannerCompressResult.processed > 0 && (
                    <p className="text-xs text-gray-600">
                      Gain total : <strong className="text-orange-600">
                        {(bannerCompressResult.totalBeforeMB - bannerCompressResult.totalAfterMB).toFixed(2)} Mo
                      </strong> ({bannerCompressResult.totalBeforeMB} Mo → {bannerCompressResult.totalAfterMB} Mo)
                    </p>
                  )}
                  {bannerCompressResult.details.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1.5">
                      {bannerCompressResult.details.map((d) => (
                        <div key={d.id} className="flex items-center justify-between text-[11px] text-gray-600">
                          <span className="truncate pr-2">{d.title}</span>
                          <span className="shrink-0 font-mono">{d.beforeMB} Mo → {d.afterMB} Mo</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: PLATFORM EVENTS LIST & SEARCH */}
        {activeSubTab === "events" && stats && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-gray-50 pb-4">
              <h4 className="text-sm font-black text-gray-950">
                Audit des Événements Créés ({filteredEvents.length})
              </h4>
              <div className="relative w-full max-w-xs">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Rechercher titre, lieu, orga..."
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 py-2.5 pr-4 pl-9 text-xs outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {filteredEvents.length === 0 && (
              <p className="text-center text-gray-400 font-semibold py-10 text-xs">Aucun événement ne correspond à ce critère de recherche.</p>
            )}

            {filteredEvents.length > 0 && <>
            {/* Vue tableau : desktop / large écrans uniquement */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                    <th className="pb-3">Visual / Titre</th>
                    <th className="pb-3 text-center">Statut</th>
                    <th className="pb-3">Organisateur</th>
                    <th className="pb-3">Date, Heure & Lieu</th>
                    <th className="pb-3">Tickets Vendus</th>
                    <th className="pb-3 text-right">Tarif Base</th>
                    <th className="pb-3 text-center">Commission</th>
                    <th className="pb-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredEvents.map((evt) => {
                    const remains = evt.totalTickets - evt.ticketsSold;
                    return (
                      <tr key={evt.id} className="hover:bg-gray-50/50">
                        <td className="py-3">
                          <div className="flex items-center space-x-3">
                            <img src={evt.banner} alt="" className="h-10 w-10 rounded-xl object-cover" />
                            <div>
                              <span className="block text-xs font-black text-gray-950 pr-4">{evt.title}</span>
                              <span className="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-gray-600 mt-1">{evt.category}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-center">{eventStatusBadge(evt)}</td>
                        <td className="py-3 font-semibold text-gray-900">
                          {evt.organizerName} <span className="block text-[9px] text-gray-400 font-mono">ID: {evt.organizerId}</span>
                        </td>
                        <td className="py-3 text-gray-600 font-semibold leading-tight">
                          <span>{new Date(evt.date).toLocaleDateString("fr-FR")} à {evt.time}</span>
                          <span className="block text-[10px] text-gray-400 truncate max-w-[150px]">{evt.venue}</span>
                        </td>
                        <td className="py-3 font-semibold text-slate-800">
                          <span className="block font-black">{evt.ticketsSold} / {evt.totalTickets} vendus</span>
                          <span className="block text-[9px] text-red-500">{remains} restants</span>
                        </td>
                        <td className="py-3 text-right font-black text-orange-600">{evt.price.toLocaleString("fr-FR")} XOF</td>
                        <td className="py-3 text-center">{commissionButton(evt)}</td>
                        <td className="py-3 text-center">
                          <div className="flex items-center justify-center space-x-1">
                            {eventActionButtons(evt)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Vue cartes : mobile / tablette uniquement */}
            <div className="md:hidden space-y-3">
              {filteredEvents.map((evt) => {
                const remains = evt.totalTickets - evt.ticketsSold;
                return (
                  <div key={evt.id} className="rounded-2xl border border-gray-100 p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <img src={evt.banner} alt="" className="h-12 w-12 rounded-xl object-cover shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-black text-gray-950">{evt.title}</span>
                        <span className="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-gray-600 mt-1">{evt.category}</span>
                      </div>
                      {eventStatusBadge(evt)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                      <div>
                        <span className="block text-[9px] font-black uppercase text-gray-400">Organisateur</span>
                        <span className="font-semibold text-gray-900">{evt.organizerName}</span>
                      </div>
                      <div>
                        <span className="block text-[9px] font-black uppercase text-gray-400">Tarif base</span>
                        <span className="font-black text-orange-600">{evt.price.toLocaleString("fr-FR")} XOF</span>
                      </div>
                      <div>
                        <span className="block text-[9px] font-black uppercase text-gray-400">Date & lieu</span>
                        <span className="font-semibold text-gray-600">{new Date(evt.date).toLocaleDateString("fr-FR")} à {evt.time}</span>
                        <span className="block text-gray-400 truncate">{evt.venue}</span>
                      </div>
                      <div>
                        <span className="block text-[9px] font-black uppercase text-gray-400">Tickets</span>
                        <span className="font-black text-slate-800">{evt.ticketsSold} / {evt.totalTickets}</span>
                        <span className="block text-red-500">{remains} restants</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                      {commissionButton(evt)}
                      <div className="flex items-center space-x-1">
                        {eventActionButtons(evt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </>}
          </div>
        )}

        {/* TAB 3: PLATFORM USER DIRECTORIES */}
        {activeSubTab === "users" && stats && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-gray-50 pb-4">
              <h4 className="text-sm font-black text-gray-950">
                Roster des Membres & Comptes ({filteredUsers.length})
              </h4>
              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative max-w-xs">
                  <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Filtrer par nom ou email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-2.5 pr-4 pl-9 text-xs outline-none focus:border-orange-500"
                  />
                </div>

                {/* Role dropdown filter */}
                <div className="flex items-center space-x-1 border border-gray-200 rounded-xl px-2.5 bg-white">
                  <Filter className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="py-2 px-1 text-xs outline-none text-gray-700 bg-transparent font-semibold border-none"
                  >
                    <option value="Tous">Tous Rôles</option>
                    <option value="client">Clients</option>
                    <option value="organizer">Organisateurs</option>
                    <option value="admin">Administrateurs</option>
                  </select>
                </div>
              </div>
            </div>

            {filteredUsers.length === 0 && (
              <p className="text-center text-gray-400 font-semibold py-10 text-xs">Aucun membre ne correspond à votre filtre.</p>
            )}

            {filteredUsers.length > 0 && <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                    <th className="pb-3">Identifiant ID</th>
                    <th className="pb-3">Nom complet / Organisation</th>
                    <th className="pb-3">Adresse de messagerie</th>
                    <th className="pb-3">Statut Rôle</th>
                    <th className="pb-3 text-center">Action administrative</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredUsers.map((usr) => (
                    <tr key={usr.id} className="hover:bg-gray-50/50">
                      <td className="py-3 font-mono text-[10px] text-gray-400 font-bold">{usr.id}</td>
                      <td className="py-3 font-black text-gray-950">{usr.name}</td>
                      <td className="py-3 text-gray-600 font-semibold font-mono">{usr.email}</td>
                      <td className="py-3">{userRoleBadge(usr.role)}</td>
                      <td className="py-3 text-center">{userDeleteAction(usr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {filteredUsers.map((usr) => (
                <div key={usr.id} className="rounded-2xl border border-gray-100 p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-gray-950 truncate">{usr.name}</p>
                    <p className="text-[10px] text-gray-600 font-semibold font-mono truncate">{usr.email}</p>
                    <p className="text-[9px] text-gray-400 font-mono mt-0.5">{usr.id}</p>
                    <div className="mt-1.5">{userRoleBadge(usr.role)}</div>
                  </div>
                  <div className="shrink-0">{userDeleteAction(usr)}</div>
                </div>
              ))}
            </div>
            </>}
          </div>
        )}

        {/* TAB 4: FLUX TRANSACTIONEL FULL HISTORIES */}
        {activeSubTab === "tickets" && stats && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-gray-50 pb-4">
              <h4 className="text-sm font-black text-gray-950">
                Audit complet des transactions et réservations ({filteredTickets.length})
              </h4>
              <div className="relative w-full max-w-xs">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Rechercher réf, acheteur, événement..."
                  value={ticketSearch}
                  onChange={(e) => setTicketSearch(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 py-2.5 pr-4 pl-9 text-xs outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {filteredTickets.length === 0 && (
              <p className="text-center text-gray-400 font-semibold py-10 text-xs">Aucun pass de réservation trouvé.</p>
            )}

            {filteredTickets.length > 0 && <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                    <th className="pb-3">ID Billet</th>
                    <th className="pb-3">Référence Transaction</th>
                    <th className="pb-3">Événement Associé</th>
                    <th className="pb-3">Acheteur</th>
                    <th className="pb-3">Quantité & Option</th>
                    <th className="pb-3">Date d'achat</th>
                    <th className="pb-3 text-right">Montant Payé</th>
                    <th className="pb-3 text-center">Statut / Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredTickets.map((tkt) => (
                    <tr key={tkt.id} className="hover:bg-gray-50/50">
                      <td className="py-3 font-mono text-[9px] text-gray-400">{tkt.id}</td>
                      <td className="py-3 font-mono font-black text-xs text-slate-900 flex items-center gap-1">
                        {tkt.paymentStatus === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" title="Paiement en attente"></span>}
                        {tkt.transactionRef}
                      </td>
                      <td className="py-3 pr-4 font-black text-slate-950 truncate max-w-[150px]" title={tkt.eventTitle}>{tkt.eventTitle}</td>
                      <td className="py-3 pr-4 font-medium text-gray-900 leading-tight max-w-[160px]">
                        <span className="block truncate">{tkt.buyerName}</span>
                        <span className="block truncate text-[9px] text-gray-400 font-mono">{tkt.buyerEmail}</span>
                      </td>
                      <td className="py-3 whitespace-nowrap">
                        <span className="font-extrabold font-sans pr-1.5">{tkt.quantity} ticket(s)</span>
                        <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[8px] font-extrabold uppercase ${
                          isVipTier(tkt.tier) ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                        }`}>
                          {formatTierLabel(tkt.tier)}
                        </span>
                      </td>
                      <td className="py-3 text-gray-400 font-mono font-semibold">{new Date(tkt.purchaseDate).toLocaleString("fr-FR")}</td>
                      <td className="py-3 text-right font-black text-orange-600">{tkt.pricePaid.toLocaleString("fr-FR")} XOF</td>
                      <td className="py-3 text-center">{ticketStatusAction(tkt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {filteredTickets.map((tkt) => (
                <div key={tkt.id} className="rounded-2xl border border-gray-100 p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black text-slate-950 truncate">{tkt.eventTitle}</p>
                      <p className="font-mono font-bold text-xs text-slate-900 flex items-center gap-1 mt-0.5">
                        {tkt.paymentStatus === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" title="Paiement en attente"></span>}
                        {tkt.transactionRef}
                      </p>
                    </div>
                    <span className="font-black text-orange-600 shrink-0">{tkt.pricePaid.toLocaleString("fr-FR")} XOF</span>
                  </div>
                  <div className="text-[11px] text-gray-600">
                    <span className="font-semibold">{tkt.buyerName}</span>
                    <span className="block text-[9px] text-gray-400 font-mono">{tkt.buyerEmail}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-gray-50 pt-2.5">
                    <div>
                      <span className="font-extrabold font-sans pr-1.5 text-[11px]">{tkt.quantity} ticket(s)</span>
                      <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[8px] font-extrabold uppercase ${
                        isVipTier(tkt.tier) ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                      }`}>
                        {formatTierLabel(tkt.tier)}
                      </span>
                    </div>
                    {ticketStatusAction(tkt)}
                  </div>
                </div>
              ))}
            </div>
            </>}
          </div>
        )}

        {/* TAB 5: DEMANDES DE RETRAIT (PAYOUTS) */}
        {activeSubTab === "payouts" && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-black text-gray-950 border-b border-gray-50 pb-4">
              Demandes de Retrait (Payouts)
            </h4>
            {payouts.length === 0 && (
              <p className="text-center text-gray-400 font-semibold py-10 text-xs">Aucune demande de retrait.</p>
            )}

            {payouts.length > 0 && <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                    <th className="pb-3">ID Demande</th>
                    <th className="pb-3">Organisateur</th>
                    <th className="pb-3">Date de Demande</th>
                    <th className="pb-3">Montant</th>
                    <th className="pb-3">Moyen / Détails</th>
                    <th className="pb-3 text-center">Action / Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {payouts.map((p: any) => (
                    <tr key={p.id}>
                      <td className="py-3 font-mono text-[9px] text-gray-400">{p.id}</td>
                      <td className="py-3 font-bold text-gray-950">{p.organizerName || p.organizerId}</td>
                      <td className="py-3 text-gray-600">{new Date(p.requestDate).toLocaleString("fr-FR")}</td>
                      <td className="py-3 font-black text-orange-600">{Number(p.amount).toLocaleString("fr-FR")} XOF</td>
                      <td className="py-3">
                        <span className="block font-bold uppercase">{p.method}</span>
                        <span className="block text-[9px] text-gray-400 font-mono">{p.details}</span>
                      </td>
                      <td className="py-3 text-center">{payoutStatusAction(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {payouts.map((p: any) => (
                <div key={p.id} className="rounded-2xl border border-gray-100 p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-950">{p.organizerName || p.organizerId}</p>
                      <p className="text-[9px] text-gray-400 font-mono">{p.id}</p>
                    </div>
                    <span className="font-black text-orange-600 shrink-0">{Number(p.amount).toLocaleString("fr-FR")} XOF</span>
                  </div>
                  <div className="text-[11px] text-gray-600">
                    <span className="block">{new Date(p.requestDate).toLocaleString("fr-FR")}</span>
                    <span className="block font-bold uppercase mt-1">{p.method}</span>
                    <span className="block text-[9px] text-gray-400 font-mono">{p.details}</span>
                  </div>
                  <div className="border-t border-gray-50 pt-2.5">{payoutStatusAction(p)}</div>
                </div>
              ))}
            </div>
            </>}
          </div>
        )}

        {/* TAB 6: LOGS TRANSACTIONS */}
        {activeSubTab === "transactions" && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-black text-gray-950 border-b border-gray-50 pb-4">
              Historique des Tentatives de Paiement
            </h4>
            {transactions.length === 0 && (
              <p className="text-center text-gray-400 font-semibold py-10 text-xs">Aucune transaction trouvée.</p>
            )}

            {transactions.length > 0 && <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                    <th className="pb-3">Transaction ID</th>
                    <th className="pb-3">Client (Email)</th>
                    <th className="pb-3">Moyen de Paiement</th>
                    <th className="pb-3">Montant</th>
                    <th className="pb-3">Date</th>
                    <th className="pb-3 text-center">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {transactions.map((tx: any) => (
                    <tr key={tx.id}>
                      <td className="py-2.5 font-mono text-[9px] text-slate-800 font-black">{tx.id}</td>
                      <td className="py-2.5 font-mono text-gray-500">{tx.buyerEmail}</td>
                      <td className="py-2.5 font-bold uppercase">{tx.method}</td>
                      <td className="py-2.5 font-black text-orange-600">{Number(tx.amount).toLocaleString("fr-FR")} XOF</td>
                      <td className="py-2.5 text-[10px] text-gray-400">{new Date(tx.date).toLocaleString("fr-FR")}</td>
                      <td className="py-2.5 text-center">{transactionStatusBadge(tx.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {transactions.map((tx: any) => (
                <div key={tx.id} className="rounded-2xl border border-gray-100 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[9px] text-slate-800 font-black">{tx.id}</p>
                      <p className="font-mono text-gray-500 text-[11px] truncate">{tx.buyerEmail}</p>
                    </div>
                    <span className="font-black text-orange-600 shrink-0">{Number(tx.amount).toLocaleString("fr-FR")} XOF</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold uppercase text-gray-600">{tx.method}</span>
                    <span className="text-gray-400">{new Date(tx.date).toLocaleString("fr-FR")}</span>
                  </div>
                  <div className="border-t border-gray-50 pt-2">{transactionStatusBadge(tx.status)}</div>
                </div>
              ))}
            </div>
            </>}
          </div>
        )}

      </section>
      </main>

      {commissionSheetEvent && stats && (
        <CommissionSheet
          event={commissionSheetEvent}
          platformDefaultRate={stats.commissionRate}
          onClose={() => setCommissionSheetEvent(null)}
          onSave={(rate) => handleSaveCommission(commissionSheetEvent, rate)}
        />
      )}
    </div>
  );
}
