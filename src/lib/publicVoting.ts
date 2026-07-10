import { VotingCampaign, Candidate } from "../types";
import { supabaseClient } from "./supabaseClient";

// Lecture publique des campagnes de vote actives, en direct depuis Supabase (même approche
// que src/lib/publicEvents.ts pour la liste d'événements) : RLS "Public read access to
// active campaigns" (voir supabase_setup.sql section 13), pas de dépendance à server.ts.
// Repli sur /api/voting/* (server.ts) si Supabase n'est pas configuré côté client (ex:
// VITE_SUPABASE_URL absent sur cet environnement) ou si la requête échoue.

function mapCandidate(c: any): Candidate {
  return {
    id: c.id,
    campaignId: c.campaign_id,
    name: c.name,
    photo: c.photo,
    description: c.description,
    displayOrder: c.display_order
  };
}

function mapCampaign(c: any): VotingCampaign {
  return {
    id: c.id,
    organizerId: c.organizer_id,
    organizerName: c.organizer_name,
    eventId: c.event_id,
    title: c.title,
    description: c.description,
    banner: c.banner,
    status: c.status,
    startDate: c.start_date,
    endDate: c.end_date,
    freeVoteWindowHours: c.free_vote_window_hours,
    premiumVotePacks: c.premium_vote_packs || [],
    commissionRate: c.commission_rate != null ? Number(c.commission_rate) : null,
    createdAt: c.created_at,
    candidates: Array.isArray(c.candidates) ? c.candidates.map(mapCandidate) : undefined
  };
}

async function fetchCampaignsViaApi(): Promise<VotingCampaign[]> {
  const response = await fetch("/api/voting/campaigns");
  if (!response.ok) throw new Error(`Échec de la requête /api/voting/campaigns (HTTP ${response.status}).`);
  return response.json();
}

export async function fetchActiveCampaigns(): Promise<VotingCampaign[]> {
  if (!supabaseClient) return fetchCampaignsViaApi();

  try {
    const { data, error } = await supabaseClient
      .from("voting_campaigns")
      .select("*, candidates(*)")
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapCampaign);
  } catch (err: any) {
    console.warn("[publicVoting] Lecture directe Supabase indisponible, repli sur /api/voting/campaigns :", err.message);
    return fetchCampaignsViaApi();
  }
}

async function fetchVoteCountsViaApi(campaignId: string): Promise<Record<string, number>> {
  const response = await fetch(`/api/voting/campaigns/${campaignId}/vote-counts`);
  if (!response.ok) throw new Error(`Échec de la requête vote-counts (HTTP ${response.status}).`);
  return response.json();
}

export async function fetchCampaignVoteCounts(campaignId: string): Promise<Record<string, number>> {
  if (!supabaseClient) return fetchVoteCountsViaApi(campaignId);

  try {
    const { data, error } = await supabaseClient.rpc("get_public_campaign_vote_counts", { p_campaign_id: campaignId });
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const row of data || []) {
      counts[row.candidate_id] = Number(row.votes);
    }
    return counts;
  } catch (err: any) {
    console.warn("[publicVoting] RPC décompte de voix indisponible, repli sur /api/voting/.../vote-counts :", err.message);
    return fetchVoteCountsViaApi(campaignId);
  }
}
