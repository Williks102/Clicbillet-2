import { isSupabaseEnabled, supabase } from "./config.js";

// ==========================================
// SALLE D'ATTENTE VIRTUELLE (pics de trafic billetterie)
// ==========================================
// Elle ne s'active plus sur une case cochée à la création de l'événement : elle S'ARME SEULE
// quand l'affluence réelle dépasse un seuil (cf. supabase_setup.sql section 26).
//
// Demander à l'organisateur de prévoir un pic revenait à lui faire prendre un pari au pire
// moment — des semaines avant, sans savoir si la demande explosera. Oubliée alors que la ruée
// arrive, la file ne protégeait rien ; cochée sans ruée, elle faisait patienter des visiteurs
// devant une salle vide, ce qui coûte des ventes. Mesurer supprime les deux cas.
//
// Pas besoin de cron : chaque appel join/status fait avancer la file via advance_waiting_room.

const DEFAUTS = { threshold: 80, capacity: 50, activeMinutes: 10, windowSeconds: 60 };

// Les réglages vivent dans platform_config : la capacité soutenable dépend du backend et de
// la passerelle de paiement, pas de l'événement. Mise en cache brièvement — ils sont lus à
// chaque entrée en paiement, et ils changent au rythme des décisions d'exploitation.
let cache: { valeurs: typeof DEFAUTS; expire: number } | null = null;
const CACHE_MS = 60_000;

export async function getWaitingRoomSettings(): Promise<typeof DEFAUTS> {
  if (cache && cache.expire > Date.now()) return cache.valeurs;
  if (!supabase) return DEFAUTS;
  try {
    const { data } = await supabase
      .from("platform_config")
      .select("key, value")
      .in("key", ["waiting_room_threshold", "waiting_room_capacity", "waiting_room_active_minutes", "waiting_room_window_seconds"]);
    const lu: Record<string, number> = {};
    for (const row of data || []) {
      const n = Number(row.value);
      if (Number.isFinite(n) && n > 0) lu[row.key] = n;
    }
    const valeurs = {
      threshold: lu.waiting_room_threshold ?? DEFAUTS.threshold,
      capacity: lu.waiting_room_capacity ?? DEFAUTS.capacity,
      activeMinutes: lu.waiting_room_active_minutes ?? DEFAUTS.activeMinutes,
      windowSeconds: lu.waiting_room_window_seconds ?? DEFAUTS.windowSeconds
    };
    cache = { valeurs, expire: Date.now() + CACHE_MS };
    return valeurs;
  } catch {
    return DEFAUTS;
  }
}

// Décide si cet acheteur doit passer par la file, en enregistrant au passage sa présence.
// Trois raisons d'armer :
//   - l'événement est une mise en vente programmée (pré-armée dès la première seconde) ;
//   - l'affluence mesurée dépasse le seuil ;
//   - quelqu'un patiente déjà — une accalmie ne doit pas faire passer les arrivants devant
//     ceux qui attendent.
export async function evaluateWaitingRoomGate(eventId: string, userId: string): Promise<{
  queueActive: boolean; capacity: number; activeMinutes: number; pressure: number; reason: string;
}> {
  const reglages = await getWaitingRoomSettings();
  const base = { capacity: reglages.capacity, activeMinutes: reglages.activeMinutes };

  if (!isSupabaseEnabled || !supabase) {
    return { queueActive: false, ...base, pressure: 0, reason: "hors-ligne" };
  }

  const { data: event } = await supabase
    .from("events")
    .select("scheduled_onsale")
    .eq("id", eventId)
    .maybeSingle();

  let pressure = 0;
  let waiting = 0;
  try {
    const { data, error } = await supabase.rpc("waiting_room_gate", {
      p_event_id: eventId,
      p_user_id: userId,
      p_window_seconds: reglages.windowSeconds
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    pressure = Number(row?.pressure) || 0;
    waiting = Number(row?.waiting) || 0;
  } catch (err: any) {
    // La mesure est indisponible : on laisse passer plutôt que de faire patienter tout le
    // monde. Une file ouverte à tort bloque des ventes ; son absence, depuis la réservation
    // atomique, ne peut plus provoquer de survente.
    console.warn(`[Waiting Room] Mesure d'affluence indisponible (${err?.message}) : accès direct au paiement.`);
    return { queueActive: false, ...base, pressure: 0, reason: "mesure-indisponible" };
  }

  if (event?.scheduled_onsale) return { queueActive: true, ...base, pressure, reason: "mise-en-vente-programmee" };
  if (pressure > reglages.threshold) return { queueActive: true, ...base, pressure, reason: "affluence" };
  if (waiting > 0) return { queueActive: true, ...base, pressure, reason: "file-en-cours" };
  return { queueActive: false, ...base, pressure, reason: "trafic-normal" };
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

