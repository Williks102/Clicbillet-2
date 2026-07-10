import { useEffect, useState } from "react";
import { Percent, ShieldOff, ShieldCheck, Users } from "lucide-react";
import { User, VotingCampaign } from "../types";
import { authFetch, TokenRefreshHandler } from "../lib/apiClient";

interface AdminVotingTabProps {
  user: User;
  onTokenRefresh: TokenRefreshHandler;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  active: "bg-emerald-50 text-emerald-600 border-emerald-200",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
  suspended: "bg-red-50 text-red-600 border-red-200"
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "Active",
  closed: "Clôturée",
  suspended: "Suspendue"
};

interface AdminVotingStats {
  totalCampaigns: number;
  totalPremiumRevenue: number;
  totalCommission: number;
  totalOrganizerPayout: number;
  commissionRate: number;
}

export default function AdminVotingTab({ user, onTokenRefresh }: AdminVotingTabProps) {
  const [campaigns, setCampaigns] = useState<VotingCampaign[]>([]);
  const [stats, setStats] = useState<AdminVotingStats | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchAll() {
    setLoading(true);
    try {
      const [campaignsRes, statsRes] = await Promise.all([
        authFetch("/api/admin/voting-campaigns", {}, user, onTokenRefresh),
        authFetch("/api/admin/voting-stats", {}, user, onTokenRefresh)
      ]);
      if (campaignsRes.ok) setCampaigns(await campaignsRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  async function handleToggleSuspend(campaign: VotingCampaign) {
    const suspend = campaign.status !== "suspended";
    const confirmMsg = suspend
      ? `Suspendre la campagne "${campaign.title}" ? Elle ne sera plus visible publiquement.`
      : `Réactiver la campagne "${campaign.title}" ?`;
    if (!confirm(confirmMsg)) return;

    const res = await authFetch(`/api/admin/voting-campaigns/${campaign.id}/suspend`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspend })
    }, user, onTokenRefresh);
    if (res.ok) fetchAll();
    else alert("Erreur lors de la mise à jour du statut.");
  }

  async function handleUpdateCommission(campaign: VotingCampaign) {
    const currentPercent = campaign.commissionRate != null ? (campaign.commissionRate * 100).toString() : "";
    const input = window.prompt(
      `Taux de commission pour "${campaign.title}" (en %, ex: 15). Laisser vide pour revenir au taux par défaut de la plateforme.`,
      currentPercent
    );
    if (input === null) return;

    let commissionRate: number | null = null;
    if (input.trim() !== "") {
      const percent = Number(input.replace(",", "."));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        alert("Taux invalide : entrez un nombre entre 0 et 100.");
        return;
      }
      commissionRate = percent / 100;
    }

    const res = await authFetch(`/api/admin/voting-campaigns/${campaign.id}/commission`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionRate })
    }, user, onTokenRefresh);
    if (res.ok) fetchAll();
    else alert("Erreur lors de la mise à jour du taux de commission.");
  }

  if (loading) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6" id="admin-voting-tab">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Campagnes" value={stats.totalCampaigns} />
          <StatTile label="Revenu voix premium" value={`${stats.totalPremiumRevenue.toLocaleString("fr-FR")} F`} />
          <StatTile label="Commission ClicBillet" value={`${stats.totalCommission.toLocaleString("fr-FR")} F`} />
          <StatTile label="Taux effectif" value={`${(stats.commissionRate * 100).toFixed(1)}%`} />
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <h4 className="text-xs font-black text-gray-900 uppercase mb-4">Toutes les campagnes ({campaigns.length})</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase text-[9px] tracking-wider">
                <th className="pb-3">Titre</th>
                <th className="pb-3">Organisateur</th>
                <th className="pb-3 text-center">Statut</th>
                <th className="pb-3 text-center">Candidats</th>
                <th className="pb-3 text-center">Commission</th>
                <th className="pb-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50">
                  <td className="py-3 font-black text-gray-950">{c.title}</td>
                  <td className="py-3 text-gray-600 font-semibold">{c.organizerName}</td>
                  <td className="py-3 text-center">
                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase border ${STATUS_STYLES[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </td>
                  <td className="py-3 text-center text-gray-600 font-semibold">
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {(c.candidates || []).length}</span>
                  </td>
                  <td className="py-3 text-center">
                    <button
                      onClick={() => handleUpdateCommission(c)}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase border transition ${
                        c.commissionRate != null
                          ? "bg-orange-50 text-orange-650 border-orange-200 hover:bg-orange-100"
                          : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
                      }`}
                    >
                      <Percent className="h-3 w-3" />
                      {c.commissionRate != null ? `${(c.commissionRate * 100).toFixed(0)}%` : "Défaut"}
                    </button>
                  </td>
                  <td className="py-3 text-center">
                    <button
                      onClick={() => handleToggleSuspend(c)}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-bold uppercase transition ${
                        c.status === "suspended"
                          ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-600"
                          : "bg-red-50 hover:bg-red-100 text-red-600"
                      }`}
                    >
                      {c.status === "suspended" ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                      {c.status === "suspended" ? "Réactiver" : "Suspendre"}
                    </button>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-gray-400 font-semibold py-10">Aucune campagne de vote créée.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-3.5">
      <span className="block text-[9px] font-bold uppercase text-gray-400">{label}</span>
      <span className="block text-base font-black text-gray-950">{value}</span>
    </div>
  );
}
