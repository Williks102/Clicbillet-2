import { isSupabaseEnabled, supabase } from "./config.js";

// ==========================================
// SALLE D'ATTENTE VIRTUELLE (pics de trafic billetterie)
// ==========================================
// Activable par événement (events.waiting_room_enabled, désactivée par défaut). Pas besoin de
// cron : chaque appel join/status fait avancer la file via la fonction Postgres
// advance_waiting_room (atomique, FOR UPDATE SKIP LOCKED côté SQL), qui expire les sessions
// "active" dépassées et promeut les plus anciens en attente pour remplir les places libérées.
export async function getWaitingRoomEventConfig(eventId: string): Promise<{ enabled: boolean; capacity: number; activeMinutes: number } | null> {
  if (!isSupabaseEnabled || !supabase) return null;
  const { data, error } = await supabase
    .from("events")
    .select("waiting_room_enabled, waiting_room_capacity, waiting_room_active_minutes")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    enabled: Boolean(data.waiting_room_enabled),
    capacity: Number(data.waiting_room_capacity) || 50,
    activeMinutes: Number(data.waiting_room_active_minutes) || 10
  };
}

export async function advanceAndGetWaitingRoomStatus(eventId: string, userId: string, config: { capacity: number; activeMinutes: number }): Promise<{ status: "waiting" | "active" | "expired"; position: number; estimatedActiveAt: string | null } | null> {
  if (!supabase) return null;

  const { error: rpcError } = await supabase.rpc("advance_waiting_room", {
    p_event_id: eventId,
    p_capacity: config.capacity,
    p_active_minutes: config.activeMinutes
  });
  if (rpcError) {
    console.error("[Waiting Room] Erreur advance_waiting_room:", rpcError.message);
  }

  const { data: entry, error: entryError } = await supabase
    .from("waiting_room_entries")
    .select("*")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (entryError || !entry) return null;

  if (entry.status === "waiting") {
    const { count } = await supabase
      .from("waiting_room_entries")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", "waiting")
      .lt("joined_at", entry.joined_at);
    const position = (count || 0) + 1;

    // Estimation : la place active qui expire la plus tôt parmi les `position`
    // places en cours d'expiration libère le tour de cet utilisateur (approximation,
    // ignore les arrivées futures dans la file).
    let estimatedActiveAt: string | null = null;
    const { data: activeEntries } = await supabase
      .from("waiting_room_entries")
      .select("active_until")
      .eq("event_id", eventId)
      .eq("status", "active")
      .order("active_until", { ascending: true })
      .limit(position);
    if (activeEntries && activeEntries.length > 0) {
      const target = activeEntries[Math.min(position, activeEntries.length) - 1];
      estimatedActiveAt = target.active_until;
    }

    return { status: "waiting", position, estimatedActiveAt };
  }

  return { status: entry.status, position: 0, estimatedActiveAt: null };
}

// Libère immédiatement la place active d'un utilisateur dès que son achat est finalisé
// (callback de paiement, simulation dev, validation manuelle admin), au lieu d'attendre
// l'expiration de active_until. Sans effet si la salle d'attente n'est pas utilisée pour cet
// événement/utilisateur (aucune ligne "active" correspondante) ou si Supabase est indisponible.
export async function releaseWaitingRoomSlot(eventId: string | null | undefined, userId: string | null | undefined): Promise<void> {
  if (!supabase || !eventId || !userId) return;
  try {
    await supabase
      .from("waiting_room_entries")
      .update({ status: "expired" })
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .eq("status", "active");
  } catch (err: any) {
    console.error("[Waiting Room] Erreur libération de place:", err.message || err);
  }
}

