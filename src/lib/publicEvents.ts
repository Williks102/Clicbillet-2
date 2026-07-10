import { Event } from "../types";
import { supabaseClient } from "./supabaseClient";
import { cachedFetch } from "./fetchCache";

// Catalogue public d'événements (page d'accueil) : lu directement depuis Supabase (clé
// anon, RLS "Public read access to approved events") plutôt que via /api/events, pour ne
// plus dépendre du cold start de la fonction serverless Vercel sur ce chemin très visité.
// Si Supabase n'est pas configuré ou que la requête échoue, on retombe sur /api/events
// (fonction serverless, avec son propre Cache-Control CDN) pour ne rien casser.

interface CacheEntry {
  data: Event[];
  expiresAt: number;
}

let cache: CacheEntry | null = null;

function mapEvent(e: any, tierSoldByEvent: Record<string, Record<string, number>>): Event {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    date: e.date,
    time: e.time,
    price: Number(e.price),
    ticketTypes: e.ticket_types,
    venue: e.venue,
    category: e.category,
    banner: e.banner,
    ticketsSold: e.tickets_sold ?? 0,
    totalTickets: e.total_tickets,
    organizerId: e.organizer_id,
    organizerName: e.organizer_name,
    status: e.status || "approved",
    waitingRoomEnabled: e.waiting_room_enabled,
    waitingRoomCapacity: e.waiting_room_capacity,
    commissionRate: e.commission_rate != null ? Number(e.commission_rate) : null,
    ticketsSoldByTier: tierSoldByEvent[e.id] || {}
  } as Event;
}

async function fetchDirectFromSupabase(): Promise<Event[]> {
  if (!supabaseClient) throw new Error("Supabase non configuré côté client.");

  const [eventsResult, tierSoldResult] = await Promise.all([
    supabaseClient.from("events").select("*").eq("status", "approved").order("created_at", { ascending: false }),
    supabaseClient.rpc("get_public_events_tier_sold")
  ]);

  if (eventsResult.error) throw eventsResult.error;

  const tierSoldByEvent: Record<string, Record<string, number>> = {};
  for (const row of tierSoldResult.data || []) {
    if (!tierSoldByEvent[row.event_id]) tierSoldByEvent[row.event_id] = {};
    tierSoldByEvent[row.event_id][row.tier] = Number(row.sold);
  }
  // La disponibilité par palier n'est qu'un affinage d'affichage : si le RPC échoue
  // (ex: migration SQL section 12 pas encore appliquée), on affiche quand même les
  // événements plutôt que de tout faire échouer.
  if (tierSoldResult.error) {
    console.warn("[publicEvents] get_public_events_tier_sold indisponible :", tierSoldResult.error.message);
  }

  return (eventsResult.data || []).map((e: any) => mapEvent(e, tierSoldByEvent));
}

export async function fetchPublicEvents(options: { ttlMs?: number; force?: boolean } = {}): Promise<Event[]> {
  const { ttlMs = 20_000, force = false } = options;

  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  try {
    const data = await fetchDirectFromSupabase();
    cache = { data, expiresAt: Date.now() + ttlMs };
    return data;
  } catch (err: any) {
    console.warn("[publicEvents] Lecture directe Supabase indisponible, repli sur /api/events :", err.message);
    return cachedFetch<Event[]>("/api/events", { ttlMs, force });
  }
}

export function invalidatePublicEventsCache() {
  cache = null;
}
