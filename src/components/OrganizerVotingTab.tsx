import { useEffect, useState } from "react";
import { Plus, Vote, Trash2, ChevronLeft, Users, TrendingUp } from "lucide-react";
import { User, VotingCampaign, Candidate, VotingCampaignStats } from "../types";
import { authFetch, TokenRefreshHandler } from "../lib/apiClient";
import ResponsiveSheet from "./ResponsiveSheet";

interface OrganizerVotingTabProps {
  user: User;
  onTokenRefresh: TokenRefreshHandler;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "Active",
  closed: "Clôturée",
  suspended: "Suspendue (admin)"
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  active: "bg-emerald-50 text-emerald-600 border-emerald-200",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
  suspended: "bg-red-50 text-red-600 border-red-200"
};

export default function OrganizerVotingTab({ user, onTokenRefresh }: OrganizerVotingTabProps) {
  const [campaigns, setCampaigns] = useState<VotingCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<VotingCampaign | null>(null);
  const [stats, setStats] = useState<VotingCampaignStats | null>(null);

  async function fetchCampaigns() {
    setLoading(true);
    try {
      const res = await authFetch(`/api/organizer/voting-campaigns?organizerId=${user.id}`, {}, user, onTokenRefresh);
      if (res.ok) setCampaigns(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCampaigns();
  }, []);

  async function fetchStats(campaignId: string) {
    const res = await authFetch(`/api/organizer/voting-campaigns/${campaignId}/stats`, {}, user, onTokenRefresh);
    if (res.ok) setStats(await res.json());
  }

  async function openManage(campaign: VotingCampaign) {
    setManaging(campaign);
    setStats(null);
    fetchStats(campaign.id);
  }

  async function handleStatusChange(campaign: VotingCampaign, status: string) {
    const res = await authFetch(`/api/organizer/voting-campaigns/${campaign.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }, user, onTokenRefresh);
    if (res.ok) {
      const updated = await res.json();
      setManaging(updated);
      fetchCampaigns();
    } else {
      alert("Erreur lors du changement de statut.");
    }
  }

  async function handleAddCandidate(campaignId: string, name: string, photo: string, description: string) {
    const res = await authFetch(`/api/organizer/voting-campaigns/${campaignId}/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, photo, description })
    }, user, onTokenRefresh);
    if (res.ok) {
      const candidate = await res.json();
      setManaging((prev) => prev ? { ...prev, candidates: [...(prev.candidates || []), candidate] } : prev);
    } else {
      alert("Erreur lors de l'ajout du candidat.");
    }
  }

  async function handleDeleteCandidate(campaignId: string, candidateId: string) {
    if (!confirm("Supprimer ce candidat ?")) return;
    const res = await authFetch(`/api/organizer/voting-campaigns/${campaignId}/candidates/${candidateId}`, { method: "DELETE" }, user, onTokenRefresh);
    if (res.ok) {
      setManaging((prev) => prev ? { ...prev, candidates: (prev.candidates || []).filter((c) => c.id !== candidateId) } : prev);
    }
  }

  if (managing) {
    return (
      <ManageCampaignView
        campaign={managing}
        stats={stats}
        onBack={() => { setManaging(null); fetchCampaigns(); }}
        onStatusChange={(status) => handleStatusChange(managing, status)}
        onAddCandidate={(name, photo, description) => handleAddCandidate(managing.id, name, photo, description)}
        onDeleteCandidate={(candidateId) => handleDeleteCandidate(managing.id, candidateId)}
      />
    );
  }

  return (
    <div className="space-y-6" id="organizer-voting-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black text-gray-900">Mes campagnes de vote ({campaigns.length})</h3>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-black text-white active:scale-95 transition"
          id="orga-voting-create-btn"
        >
          <Plus className="h-4 w-4" /> Nouvelle campagne
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
        </div>
      ) : campaigns.length === 0 ? (
        <p className="text-center text-xs font-semibold text-gray-400 py-12">
          Aucune campagne de vote pour l'instant. Créez-en une pour commencer.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {campaigns.map((c) => (
            <button
              key={c.id}
              onClick={() => openManage(c)}
              className="text-left bg-white border border-gray-100 rounded-2xl p-4 hover:shadow-md transition"
              id={`orga-voting-card-${c.id}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-gray-950 truncate">{c.title}</span>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase border ${STATUS_STYLES[c.status]}`}>
                  {STATUS_LABELS[c.status]}
                </span>
              </div>
              <span className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 font-semibold">
                <Users className="h-3 w-3" /> {(c.candidates || []).length} candidat(s)
              </span>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <CreateCampaignSheet
          user={user}
          onTokenRefresh={onTokenRefresh}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); fetchCampaigns(); }}
        />
      )}
    </div>
  );
}

function ManageCampaignView({
  campaign,
  stats,
  onBack,
  onStatusChange,
  onAddCandidate,
  onDeleteCandidate
}: {
  campaign: VotingCampaign;
  stats: VotingCampaignStats | null;
  onBack: () => void;
  onStatusChange: (status: string) => void;
  onAddCandidate: (name: string, photo: string, description: string) => void;
  onDeleteCandidate: (candidateId: string) => void;
}) {
  const [candName, setCandName] = useState("");
  const [candPhoto, setCandPhoto] = useState("");
  const [candDescription, setCandDescription] = useState("");

  return (
    <div className="space-y-6" id="orga-voting-manage-view">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-orange-600">
        <ChevronLeft className="h-4 w-4" /> Retour aux campagnes
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-lg font-black text-gray-950">{campaign.title}</h3>
        <div className="flex gap-2">
          {campaign.status === "draft" && (
            <button onClick={() => onStatusChange("active")} className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black text-white">
              Publier
            </button>
          )}
          {campaign.status === "active" && (
            <button onClick={() => onStatusChange("closed")} className="rounded-xl bg-slate-700 px-3 py-2 text-[11px] font-black text-white">
              Clôturer
            </button>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Voix gratuites" value={stats.freeVotes} />
          <StatTile label="Voix premium" value={stats.premiumVotes} />
          <StatTile label="Revenu net (XOF)" value={stats.totalRevenue.toLocaleString("fr-FR")} />
          <StatTile label="Commission" value={`${(stats.commissionRate * 100).toFixed(0)}%`} />
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-black text-gray-900 uppercase">Candidats ({(campaign.candidates || []).length})</h4>
        <div className="space-y-2">
          {(campaign.candidates || []).map((c: Candidate) => (
            <div key={c.id} className="flex items-center justify-between p-2.5 border border-gray-100 rounded-xl">
              <div className="flex items-center gap-2 min-w-0">
                {c.photo && <img src={c.photo} alt="" className="h-8 w-8 rounded-lg object-cover shrink-0" />}
                <span className="text-xs font-bold text-gray-800 truncate">{c.name}</span>
              </div>
              <button onClick={() => onDeleteCandidate(c.id)} className="p-1.5 rounded-md hover:bg-red-50 text-red-500 shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {(campaign.candidates || []).length === 0 && (
            <p className="text-[11px] text-gray-400 font-semibold text-center py-3">Aucun candidat pour l'instant.</p>
          )}
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-2">
          <input
            value={candName}
            onChange={(e) => setCandName(e.target.value)}
            placeholder="Nom du candidat"
            className="w-full rounded-xl border border-gray-200 py-2 px-3 text-xs outline-none focus:border-orange-500"
          />
          <input
            value={candPhoto}
            onChange={(e) => setCandPhoto(e.target.value)}
            placeholder="URL photo (optionnel)"
            className="w-full rounded-xl border border-gray-200 py-2 px-3 text-xs outline-none focus:border-orange-500"
          />
          <textarea
            value={candDescription}
            onChange={(e) => setCandDescription(e.target.value)}
            placeholder="Description (optionnel)"
            rows={2}
            className="w-full rounded-xl border border-gray-200 py-2 px-3 text-xs outline-none focus:border-orange-500"
          />
          <button
            onClick={() => {
              if (!candName.trim()) return;
              onAddCandidate(candName, candPhoto, candDescription);
              setCandName(""); setCandPhoto(""); setCandDescription("");
            }}
            className="w-full rounded-xl bg-gray-900 py-2.5 text-[11px] font-black text-white active:scale-[0.98] transition"
          >
            + Ajouter un candidat
          </button>
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

function CreateCampaignSheet({
  user,
  onTokenRefresh,
  onClose,
  onCreated
}: {
  user: User;
  onTokenRefresh: TokenRefreshHandler;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [banner, setBanner] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [packs, setPacks] = useState<{ votes: string; price: string }[]>([{ votes: "10", price: "1000" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updatePack(index: number, field: "votes" | "price", value: string) {
    setPacks((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  async function handleSubmit() {
    setError(null);
    if (!title || !startDate || !endDate) {
      setError("Titre, date de début et date de fin sont obligatoires.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch("/api/organizer/voting-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          banner: banner || undefined,
          startDate,
          endDate,
          organizerName: user.name,
          premiumVotePacks: packs
            .filter((p) => Number(p.votes) > 0 && Number(p.price) >= 0)
            .map((p) => ({ votes: Number(p.votes), price: Number(p.price) }))
        })
      }, user, onTokenRefresh);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la création.");
      onCreated();
    } catch (e: any) {
      setError(e.message || "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveSheet id="create-voting-campaign-sheet" onClose={onClose} panelClassName="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Vote className="h-4 w-4 text-orange-600" />
          <h3 className="text-sm font-black text-gray-950">Nouvelle campagne de vote</h3>
        </div>
      </div>
      <div className="p-5 space-y-3 overflow-y-auto">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre de la campagne"
          className="w-full rounded-xl border border-gray-200 py-2.5 px-3.5 text-xs outline-none focus:border-orange-500"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          rows={3}
          className="w-full rounded-xl border border-gray-200 py-2.5 px-3.5 text-xs outline-none focus:border-orange-500"
        />
        <input
          value={banner}
          onChange={(e) => setBanner(e.target.value)}
          placeholder="URL bannière (optionnel)"
          className="w-full rounded-xl border border-gray-200 py-2.5 px-3.5 text-xs outline-none focus:border-orange-500"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">Début</label>
            <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border border-gray-200 py-2 px-3 text-xs outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">Fin</label>
            <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-xl border border-gray-200 py-2 px-3 text-xs outline-none focus:border-orange-500" />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase">Packs de voix premium</label>
          <div className="space-y-2 mt-1">
            {packs.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="number"
                  value={p.votes}
                  onChange={(e) => updatePack(i, "votes", e.target.value)}
                  placeholder="Voix"
                  className="w-1/2 rounded-xl border border-gray-200 py-2 px-3 text-xs outline-none focus:border-orange-500"
                />
                <input
                  type="number"
                  value={p.price}
                  onChange={(e) => updatePack(i, "price", e.target.value)}
                  placeholder="Prix XOF"
                  className="w-1/2 rounded-xl border border-gray-200 py-2 px-3 text-xs outline-none focus:border-orange-500"
                />
              </div>
            ))}
            <button
              onClick={() => setPacks((prev) => [...prev, { votes: "", price: "" }])}
              className="text-[11px] font-bold text-orange-600"
            >
              + Ajouter un pack
            </button>
          </div>
        </div>

        {error && <p className="text-[11px] font-bold text-red-600">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-2xl bg-orange-600 py-3 text-xs font-black uppercase text-white active:scale-[0.98] transition disabled:opacity-60"
        >
          {submitting ? "Création..." : "Créer la campagne (brouillon)"}
        </button>
      </div>
    </ResponsiveSheet>
  );
}
