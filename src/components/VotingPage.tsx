import { useEffect, useState } from "react";
import { ChevronLeft, Heart, Sparkles, Vote as VoteIcon } from "lucide-react";
import { VotingCampaign, Candidate, User } from "../types";
import { fetchActiveCampaigns, fetchCampaignVoteCounts } from "../lib/publicVoting";
import { getDeviceFingerprint } from "../lib/voterIdentity";
import VotePremiumSheet from "./VotePremiumSheet";

interface VotingPageProps {
  user: User | null;
  pushToast: (message: string) => void;
  deepLinkCampaignId?: string | null;
  onDeepLinkConsumed?: () => void;
}

export default function VotingPage({ user, pushToast, deepLinkCampaignId, onDeepLinkConsumed }: VotingPageProps) {
  const [campaigns, setCampaigns] = useState<VotingCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<VotingCampaign | null>(null);
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [votingCandidateId, setVotingCandidateId] = useState<string | null>(null);
  const [premiumCandidate, setPremiumCandidate] = useState<Candidate | null>(null);

  useEffect(() => {
    fetchActiveCampaigns().then((data) => {
      setCampaigns(data);
      setLoading(false);
    });
  }, []);

  // Arrivée depuis la page d'accueil sur une campagne précise (cf. LandingPage) : on ouvre
  // directement son détail dès que la liste des campagnes est chargée, puis on "consomme"
  // le deep-link pour ne pas ré-ouvrir la même campagne si l'utilisateur revient en arrière.
  useEffect(() => {
    if (!deepLinkCampaignId || campaigns.length === 0) return;
    const match = campaigns.find((c) => c.id === deepLinkCampaignId);
    if (match) setSelectedCampaign(match);
    onDeepLinkConsumed?.();
  }, [deepLinkCampaignId, campaigns]);

  useEffect(() => {
    if (!selectedCampaign) return;
    let cancelled = false;
    async function loadCounts() {
      const counts = await fetchCampaignVoteCounts(selectedCampaign!.id);
      if (!cancelled) setVoteCounts(counts);
    }
    loadCounts();
    const interval = setInterval(loadCounts, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedCampaign]);

  async function handleFreeVote(candidate: Candidate) {
    if (!selectedCampaign) return;
    setVotingCandidateId(candidate.id);
    try {
      const response = await fetch(
        `/api/voting/campaigns/${selectedCampaign.id}/candidates/${candidate.id}/vote-free`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
          body: JSON.stringify({ deviceFingerprint: getDeviceFingerprint() })
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erreur lors du vote.");
      pushToast(`Vote enregistré pour ${candidate.name} !`);
      const counts = await fetchCampaignVoteCounts(selectedCampaign.id);
      setVoteCounts(counts);
    } catch (e: any) {
      pushToast(e.message || "Impossible d'enregistrer votre vote.");
    } finally {
      setVotingCandidateId(null);
    }
  }

  if (loading) {
    return (
      <div className="py-24 text-center" id="voting-loading">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
        <p className="mt-4 text-xs font-bold text-gray-500">Chargement des campagnes de vote...</p>
      </div>
    );
  }

  if (selectedCampaign) {
    const candidates = (selectedCampaign.candidates || []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
    const totalVotes = Object.values(voteCounts).reduce((s, v) => s + v, 0) || 1;
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5" id="voting-campaign-detail">
        <button
          onClick={() => setSelectedCampaign(null)}
          className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-orange-600"
        >
          <ChevronLeft className="h-4 w-4" /> Retour aux campagnes
        </button>

        {selectedCampaign.banner && (
          <img src={selectedCampaign.banner} alt="" className="w-full h-40 object-cover rounded-3xl" />
        )}
        <div>
          <h1 className="text-xl font-black text-gray-950">{selectedCampaign.title}</h1>
          <p className="mt-1 text-xs text-gray-500">{selectedCampaign.description}</p>
        </div>

        <div className="space-y-3">
          {candidates.map((candidate) => {
            const votes = voteCounts[candidate.id] || 0;
            const pct = Math.round((votes / totalVotes) * 100);
            return (
              <div key={candidate.id} className="bg-white border border-gray-100 rounded-2xl p-4" id={`candidate-${candidate.id}`}>
                <div className="flex items-center gap-3">
                  {candidate.photo && (
                    <img src={candidate.photo} alt="" className="h-14 w-14 rounded-xl object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="block text-sm font-black text-gray-950 truncate">{candidate.name}</span>
                    <span className="block text-[10px] text-gray-400 font-semibold">{votes.toLocaleString("fr-FR")} voix ({pct}%)</span>
                  </div>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-orange-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleFreeVote(candidate)}
                    disabled={votingCandidateId === candidate.id}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2 text-[11px] font-bold text-gray-700 hover:border-orange-300 active:scale-[0.98] transition disabled:opacity-60"
                  >
                    <Heart className="h-3.5 w-3.5" /> Vote gratuit
                  </button>
                  {selectedCampaign.premiumVotePacks.length > 0 && (
                    <button
                      onClick={() => setPremiumCandidate(candidate)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-orange-600 py-2 text-[11px] font-bold text-white active:scale-[0.98] transition"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Booster
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {premiumCandidate && (
          <VotePremiumSheet
            campaign={selectedCampaign}
            candidate={premiumCandidate}
            user={user}
            onClose={() => setPremiumCandidate(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5" id="voting-campaigns-list">
      <div className="flex items-center gap-2">
        <VoteIcon className="h-5 w-5 text-orange-600" />
        <h1 className="text-lg font-black text-gray-950">Campagnes de vote</h1>
      </div>

      {campaigns.length === 0 && (
        <p className="text-xs font-semibold text-gray-400 py-10 text-center">Aucune campagne de vote active pour le moment.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {campaigns.map((campaign) => (
          <button
            key={campaign.id}
            onClick={() => setSelectedCampaign(campaign)}
            className="text-left bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-md transition"
            id={`campaign-card-${campaign.id}`}
          >
            {campaign.banner && <img src={campaign.banner} alt="" className="w-full h-28 object-cover" />}
            <div className="p-4">
              <span className="block text-sm font-black text-gray-950">{campaign.title}</span>
              <span className="block mt-1 text-[10px] text-gray-400 font-semibold">
                {(campaign.candidates || []).length} candidat(s)
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
