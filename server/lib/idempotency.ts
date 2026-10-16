// Déduplication des requêtes qui créent quelque chose (POST /api/checkout, POST
// /api/organizer/payouts) : sans ça, un double-clic ou un retry réseau crée deux commandes ou
// deux demandes de retrait pour la même intention, chacune traitée comme légitime par le reste
// du système (cf. supabase_setup.sql section 32 pour le détail du compromis).
//
// Le principe (même contrat qu'une clé d'idempotence Stripe) : le client fournit une clé par
// TENTATIVE (pas par contenu de commande), stable à travers ses propres retries. Trois issues
// possibles à la première lecture de cette clé :
//   - elle n'existe pas encore -> on laisse la route s'exécuter normalement ("proceed") ;
//   - elle existe, avec le même contenu de requête, et une réponse déjà enregistrée -> on
//     REJOUE cette réponse sans ré-exécuter la route ("replay") ;
//   - elle existe mais avec un contenu de requête différent -> la clé a été réutilisée pour une
//     commande différente, on refuse plutôt que de répondre au hasard ("conflict").
// Une clé encore "processing" (une requête avec la même clé est en cours ailleurs) renvoie
// "in_progress" : la route n'a pas à inventer un comportement pour ce cas rarissime.
import crypto from "crypto";
import { isSupabaseEnabled, supabase } from "./config.js";
import { saveDB } from "./db.js";

export type IdempotencyOutcome =
  | { outcome: "proceed" }
  | { outcome: "replay"; statusCode: number; body: any }
  | { outcome: "conflict" }
  | { outcome: "in_progress" };

function hashPayload(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function usesSupabase(): boolean {
  return Boolean(isSupabaseEnabled && supabase);
}

export async function beginIdempotentRequest(
  key: string,
  scope: string,
  payload: unknown,
  db?: any
): Promise<IdempotencyOutcome> {
  const requestHash = hashPayload(payload);

  if (usesSupabase()) {
    const { error: insertError } = await supabase!
      .from("idempotency_keys")
      .insert({ key, scope, request_hash: requestHash, status: "processing" });

    if (!insertError) return { outcome: "proceed" };
    if (insertError.code !== "23505") throw insertError; // autre chose qu'un conflit de clé déjà existante

    const { data: existing, error: fetchError } = await supabase!
      .from("idempotency_keys")
      .select("request_hash, status, status_code, response")
      .eq("key", key)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return { outcome: "proceed" }; // course rarissime : la ligne a disparu entre l'échec d'insertion et cette lecture

    if (existing.request_hash !== requestHash) return { outcome: "conflict" };
    if (existing.status === "processing") return { outcome: "in_progress" };
    return { outcome: "replay", statusCode: existing.status_code, body: existing.response };
  }

  if (!Array.isArray(db.idempotencyKeys)) db.idempotencyKeys = [];
  const existing = db.idempotencyKeys.find((k: any) => k.key === key);
  if (!existing) {
    db.idempotencyKeys.push({
      key, scope, requestHash, status: "processing",
      statusCode: null, response: null, createdAt: new Date().toISOString()
    });
    saveDB(db);
    return { outcome: "proceed" };
  }
  if (existing.requestHash !== requestHash) return { outcome: "conflict" };
  if (existing.status === "processing") return { outcome: "in_progress" };
  return { outcome: "replay", statusCode: existing.statusCode, body: existing.response };
}

// À appeler pour TOUTE issue définitive de la requête, succès comme échec métier (ex: "plus de
// place disponible") : rejouer cette réponse plus tard est correct pour les deux, puisqu'elle
// découle uniquement du contenu de la requête (déjà vérifié identique via request_hash).
export async function completeIdempotentRequest(key: string, statusCode: number, body: any, db?: any): Promise<void> {
  if (usesSupabase()) {
    const { error } = await supabase!
      .from("idempotency_keys")
      .update({ status: "completed", status_code: statusCode, response: body })
      .eq("key", key);
    if (error) throw error;
    return;
  }
  const entry = db.idempotencyKeys?.find((k: any) => k.key === key);
  if (entry) {
    entry.status = "completed";
    entry.statusCode = statusCode;
    entry.response = body;
    saveDB(db);
  }
}

// À appeler quand la requête échoue pour une raison qui n'a rien à voir avec son contenu (panne
// Supabase, Paystack indisponible...) : la clé est libérée pour qu'un vrai retry du client
// reparte à zéro, plutôt que de rester bloquée sur un échec purement transitoire.
export async function abandonIdempotentRequest(key: string, db?: any): Promise<void> {
  if (usesSupabase()) {
    const { error } = await supabase!.from("idempotency_keys").delete().eq("key", key);
    if (error) throw error;
    return;
  }
  if (Array.isArray(db.idempotencyKeys)) {
    db.idempotencyKeys = db.idempotencyKeys.filter((k: any) => k.key !== key);
    saveDB(db);
  }
}
