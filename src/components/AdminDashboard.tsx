import React, { useState, useEffect } from "react";
import { User, Event, Ticket } from "../types";
import {
  Building2, Users, Calendar, DollarSign, Trash2, ShieldCheck,
  Search, ShieldAlert, Sparkles, LogOut, Ticket as TicketIcon, TrendingUp, Filter
} from "lucide-react";
import { authFetch, TokenRefreshHandler } from "../lib/apiClient";
import { isEventPast } from "../lib/eventStatus";
import DashboardMobileMenu from "./DashboardMobileMenu";

interface AdminDashboardProps {
  user: User;
  onLogout: () => void;
  onTokenRefresh: TokenRefreshHandler;
}

interface AdminStats {
  totalRevenue: number; // Gross Vol. Affaires
  totalPlatformCommission: number; // 10% Platform share
  totalOrganizerPayout: number; // 90% Net share paid to organizers
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

export default function AdminDashboard({ user, onLogout, onTokenRefresh }: AdminDashboardProps) {
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

  const handleValidatePayment = async (referenceNumber: string) => {
    if (!window.confirm("Valider manuellement ce paiement ? Le client recevra son ticket avec le QR code.")) {
      return;
    }

    try {
      const resp = await authFetch("/api/admin/validate-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceNumber })
      }, user, onTokenRefresh);
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

  async function fetchAdminData() {
    setLoading(true);
    setError(null);
    try {
      const [response, respPayouts, respTx] = await Promise.all([
        authFetch("/api/admin/stats", {}, user, onTokenRefresh),
        authFetch("/api/admin/payouts", {}, user, onTokenRefresh),
        authFetch("/api/admin/transactions", {}, user, onTokenRefresh)
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
      }, user, onTokenRefresh);
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
      }, user, onTokenRefresh);
      if (!response.ok) throw new Error("Erreur de mise à jour.");
      fetchAdminData();
    } catch (err: any) { alert(err.message); }
  }

  async function handleDeleteEvent(id: string) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cet événement de la plateforme ? Cette action est irréversible.")) return;
    try {
      const response = await authFetch(`/api/admin/events/${id}`, { method: "DELETE" }, user, onTokenRefresh);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Erreur de suppression.");
      }
      fetchAdminData(); // Refresh metrics
    } catch (err: any) {
      alert(err.message || "Erreur lors de la suppression de l'événement.");
    }
  }

  async function handleDeleteUser(id: string) {
    if (!confirm("Êtes-vous sûr de vouloir révoquer ce compte utilisateur de ClicBillet ? Cette action est irréversible.")) return;
    try {
      const response = await authFetch(`/api/admin/users/${id}`, { method: "DELETE" }, user, onTokenRefresh);
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
              <h2 className="text-xl font-black tracking-tight text-white truncate" title={user.name}>
                {user.name}
              </h2>
              <p className="mt-1 text-[10px] text-slate-400 font-medium truncate">
                {user.email}
              </p>
            </div>
            
            <button
              onClick={onLogout}
              className="mt-2 inline-flex w-full items-center justify-center space-x-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2 text-xs font-bold text-white transition-all active:scale-95 shrink-0 lg:hidden"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Déconnexion</span>
            </button>
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

        <button
          onClick={onLogout}
          className="hidden lg:flex w-full items-center justify-center space-x-2 rounded-xl bg-gray-50 hover:bg-red-50 border border-gray-100 hover:border-red-100 text-gray-500 hover:text-red-600 px-4 py-2.5 text-xs font-bold transition-all active:scale-95 shrink-0"
        >
          <LogOut className="h-4 w-4" />
          <span>Déconnexion</span>
        </button>
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
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-6" id="admin-kpis-grid">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs col-span-2 sm:col-span-1 lg:col-span-2">
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

            <div className="rounded-2xl border border-orange-100 bg-orange-50/25 p-5 shadow-xs col-span-2 sm:col-span-1 lg:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-orange-500 text-[10px] font-black uppercase tracking-wider">Commission ClicBillet</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                  <Sparkles className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3.5 text-xl font-black text-orange-950 font-sans tracking-tight">
                {(stats.totalPlatformCommission || 0).toLocaleString("fr-FR")} <span className="text-xs text-orange-650">FCFA</span>
              </p>
              <p className="mt-1 text-[10px] text-orange-500 font-bold uppercase">Revenus Admin (10%)</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs col-span-2 sm:col-span-1 lg:col-span-2">
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

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Billets vendus</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <TicketIcon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-1.5 text-base font-black text-slate-900 font-sans tracking-tight">
                {stats.totalTicketsSold.toLocaleString("fr-FR")}
              </p>
              <p className="mt-1 text-[9px] text-gray-400 font-bold uppercase">Réservations validées</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Utilisateurs</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Users className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-1.5 text-base font-black text-slate-900 font-sans tracking-tight">
                {stats.totalUsers.toLocaleString("fr-FR")}
              </p>
              <p className="mt-1 text-[9px] text-gray-400 font-bold uppercase">Membres enregistrés</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xs col-span-2 sm:col-span-1 lg:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Événements</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <Calendar className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-1.5 text-base font-black text-slate-900 font-sans tracking-tight">
                {stats.totalEvents.toLocaleString("fr-FR")}
              </p>
              <p className="mt-1 text-[9px] text-gray-400 font-bold uppercase">Événements en ligne</p>
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
                        ? "bg-orange-100 text-orange-850" 
                        : "bg-blue-100 text-blue-800"
                    }`}>
                      {usr.role}
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
                        <td className="py-3 text-right font-black text-orange-650">{tkt.pricePaid.toLocaleString("fr-FR")} F CFA</td>
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
          </div>
        )}

        {/* TAB 2: PLATFORM EVENTS LIST & SEARCH */}
        {activeSubTab === "events" && stats && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-gray-50 pb-4">
              <h4 className="text-sm font-black text-gray-955">
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

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                    <th className="pb-3">Visual / Titre</th>
                    <th className="pb-3 text-center">Statut</th>
                    <th className="pb-3">Organisateur</th>
                    <th className="pb-3">Date, Heure & Lieu</th>
                    <th className="pb-3">Tickets Vaudou</th>
                    <th className="pb-3 text-right">Tarif Base</th>
                    <th className="pb-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredEvents.map((evt) => {
                    const remains = evt.totalTickets - evt.ticketsSold;
                    const isPast = evt.status === "approved" && isEventPast(evt);
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
                        <td className="py-3 text-center">
                          {evt.status === "pending" ? (
                            <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-md text-[10px] font-bold uppercase border border-amber-200">En Attente</span>
                          ) : evt.status === "rejected" ? (
                            <span className="px-2 py-1 bg-red-50 text-red-600 rounded-md text-[10px] font-bold uppercase border border-red-200">Rejeté</span>
                          ) : isPast ? (
                            <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase border border-slate-200">Terminé</span>
                          ) : (
                            <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-bold uppercase border border-emerald-200">Approuvé</span>
                          )}
                        </td>
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
                        <td className="py-3 text-right font-black text-orange-650">{evt.price.toLocaleString("fr-FR")} XOF</td>
                        <td className="py-3 text-center">
                          <div className="flex items-center justify-center space-x-1">
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
                              className="bg-red-50 hover:bg-red-150 text-red-650 p-1.5 rounded-md transition ml-2"
                              title="Supprimer l'événement de la plateforme"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredEvents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-gray-400 font-semibold py-10">Aucun événement ne correspond à ce critère de recherche.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: PLATFORM USER DIRECTORIES */}
        {activeSubTab === "users" && stats && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-gray-50 pb-4">
              <h4 className="text-sm font-black text-gray-955">
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
                  <Filter className="h-3.5 w-3.5 text-gray-450 shrink-0" />
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

            <div className="overflow-x-auto">
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
                      <td className="py-3">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${
                          usr.role === "admin" 
                            ? "bg-purple-100 text-purple-800" 
                            : usr.role === "organizer" 
                            ? "bg-orange-100 text-orange-850" 
                            : "bg-blue-100 text-blue-800"
                        }`}>
                          {usr.role === "admin" ? "Administrateur" : usr.role === "organizer" ? "Organisateur" : "Client / Acheteur"}
                        </span>
                      </td>
                      <td className="py-3 text-center">
                        {usr.id === "usr-admin" ? (
                          <span className="text-[10px] text-gray-350 font-bold uppercase italic">Intouchable</span>
                        ) : (
                          <button
                            onClick={() => handleDeleteUser(usr.id)}
                            className="bg-red-50 hover:bg-red-100 text-red-650 p-2 rounded-xl transition"
                            title="Révoquer le compte définitivement"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-gray-400 font-semibold py-10">Aucun membre ne correspond à votre filtre.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: FLUX TRANSACTIONEL FULL HISTORIES */}
        {activeSubTab === "tickets" && stats && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-b border-gray-50 pb-4">
              <h4 className="text-sm font-black text-gray-955">
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

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                    <th className="pb-3">ID Billet</th>
                    <th className="pb-3">Référence Transaction</th>
                    <th className="pb-3">Événement Associé</th>
                    <th className="pb-3">Acheteur</th>
                    <th className="pb-3">Quantité & Option</th>
                    <th className="pb-3">Date d'achat</th>
                    <th className="pb-3 text-right">Frais d'approvisionnement</th>
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
                      <td className="py-3 font-black text-slate-950 truncate max-w-[150px]" title={tkt.eventTitle}>{tkt.eventTitle}</td>
                      <td className="py-3 font-medium text-gray-900 leading-tight">
                        <span>{tkt.buyerName}</span>
                        <span className="block text-[9px] text-gray-450 font-mono">{tkt.buyerEmail}</span>
                      </td>
                      <td className="py-3">
                        <span className="font-extrabold font-sans pr-1.5">{tkt.quantity} ticket(s)</span>
                        <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[8px] font-extrabold uppercase ${
                          tkt.tier === "vip" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                        }`}>
                          {tkt.tier === "vip" ? "VIP" : "STD"}
                        </span>
                      </td>
                      <td className="py-3 text-gray-400 font-mono font-semibold">{new Date(tkt.purchaseDate).toLocaleString("fr-FR")}</td>
                      <td className="py-3 text-right font-black text-orange-650">{tkt.pricePaid.toLocaleString("fr-FR")} XOF</td>
                      <td className="py-3 text-center">
                        {tkt.paymentStatus === "pending" ? (
                          <button onClick={() => handleValidatePayment(tkt.id)} className="bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-all">
                            Valider manuellement
                          </button>
                        ) : (
                          <div className="inline-flex items-center space-x-1 text-green-700 bg-green-50 px-2 py-1 rounded-md">
                            <span className="text-[10px] font-bold uppercase tracking-wider">Payé</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredTickets.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-gray-400 font-semibold py-10">Aucun pass de réservation trouvé.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: DEMANDES DE RETRAIT (PAYOUTS) */}
        {activeSubTab === "payouts" && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-black text-gray-955 border-b border-gray-50 pb-4">
              Demandes de Retrait (Payouts)
            </h4>
            <div className="overflow-x-auto">
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
                      <td className="py-3 font-black text-orange-650">{Number(p.amount).toLocaleString("fr-FR")} XOF</td>
                      <td className="py-3">
                        <span className="block font-bold uppercase">{p.method}</span>
                        <span className="block text-[9px] text-gray-400 font-mono">{p.details}</span>
                      </td>
                      <td className="py-3 text-center">
                        {p.status === "pending" ? (
                          <div className="flex justify-center space-x-2">
                            <button onClick={() => handleUpdatePayout(p.id, "completed")} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2 py-1 text-[10px] font-bold rounded">Payer</button>
                            <button onClick={() => handleUpdatePayout(p.id, "rejected")} className="bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1 text-[10px] font-bold rounded">Refuser</button>
                          </div>
                        ) : p.status === "completed" ? (
                          <span className="text-emerald-500 font-bold text-[10px] uppercase">Réglé</span>
                        ) : (
                          <span className="text-red-500 font-bold text-[10px] uppercase">Rejeté</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {payouts.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-gray-400">Aucune demande de retrait.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: LOGS TRANSACTIONS */}
        {activeSubTab === "transactions" && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <h4 className="text-sm font-black text-gray-955 border-b border-gray-50 pb-4">
              Historique des Tentatives de Paiement
            </h4>
            <div className="overflow-x-auto">
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
                      <td className="py-2.5 font-black text-orange-650">{Number(tx.amount).toLocaleString("fr-FR")} XOF</td>
                      <td className="py-2.5 text-[10px] text-gray-400">{new Date(tx.date).toLocaleString("fr-FR")}</td>
                      <td className="py-2.5 text-center">
                        {tx.status === "success" ? (
                          <span className="text-emerald-500 font-bold text-[10px] uppercase">Succès</span>
                        ) : tx.status === "failed" ? (
                          <span className="text-red-500 font-bold text-[10px] uppercase">Échec</span>
                        ) : (
                          <span className="text-amber-500 font-bold text-[10px] uppercase">En Attente</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-gray-400">Aucune transaction trouvée.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </section>
      </main>
    </div>
  );
}
