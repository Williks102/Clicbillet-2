import { VotingCampaign, Candidate } from "../types";
import { supabaseClient } from "./supabaseClient";

// Lecture publique des campagnes de vote actives, en direct depuis Supabase (même approche
// que src/lib/publicEvents.ts pour la liste d'événements) : RLS "Public read access to
// active campaigns" (voir supabase_setup.sql section 13), pas de dépendance à server.ts.

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

export async function fetchActiveCampaigns(): Promise<VotingCampaign[]> {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from("voting_campaigns")
    .select("*, candidates(*)")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[publicVoting] Erreur chargement campagnes:", error.message);
    return [];
  }
  return (data || []).map(mapCampaign);
}

export async function fetchCampaignVoteCounts(campaignId: string): Promise<Record<string, number>> {
  if (!supabaseClient) return {};
  const { data, error } = await supabaseClient.rpc("get_public_campaign_vote_counts", { p_campaign_id: campaignId });
  if (error) {
    console.warn("[publicVoting] Erreur chargement décompte de voix:", error.message);
    return {};
  }
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.candidate_id] = Number(row.votes);
  }
  return counts;
}
