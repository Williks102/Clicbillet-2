import { supabase } from "./config.js";
import { runInBackground } from "./utils.js";
import { sendVoteConfirmationEmail } from "./email.js";

// Miroir de paymentConfirmation.ts (tickets) pour les achats de voix premium. Une commande
// de voix (order_id, VOTE-ORD-xxxxx) crée une seule ligne "votes" (type=premium, quantity=N)
// avec transaction_ref PENDING-VOTE-... — pas de multi-lignes comme les tickets puisqu'un
// achat de voix n'a qu'un seul candidat/quantité, pas de paniers mixtes.
export interface ResolvedVoteOrder {
  orderId: string;
  row: any;
}

export async function findVoteOrderByReference(candidates: Array<string | null | undefined>): Promise<ResolvedVoteOrder | null> {
  const cleaned = Array.from(new Set(candidates.filter((c): c is string => !!c)));
  if (cleaned.length === 0 || !supabase) return null;

  const orClause = cleaned
    .flatMap((ref) => [`order_id.eq.${ref}`, `id.eq.${ref}`, `transaction_ref.eq.${ref}`])
    .join(",");
  const { data, error } = await supabase.from("votes").select("*").eq("type", "premium").or(orClause);
  if (error || !data || data.length === 0) return null;

  const row = data[0];
  return { orderId: row.order_id || row.id, row };
}

export async function confirmVoteOrder(resolved: ResolvedVoteOrder): Promise<boolean> {
  if (!supabase) return false;
  const currentRef = String(resolved.row.transaction_ref || "");
  if (!currentRef.startsWith("PENDING-")) return false;
  const newRef = currentRef.replace("PENDING-", "PAID-");

  const { error } = await supabase.from("votes").update({ transaction_ref: newRef }).eq("id", resolved.row.id);
  if (error) {
    console.error(`[Vote Confirmation] Échec mise à jour pour id=${resolved.row.id}:`, error.message);
    return false;
  }
  await supabase.from("vote_transactions").update({ status: "paid" }).eq("id", resolved.orderId);

  if (resolved.row.voter_email) {
    try {
      const [{ data: campaign }, { data: candidate }] = await Promise.all([
        supabase.from("voting_campaigns").select("title").eq("id", resolved.row.campaign_id).maybeSingle(),
        supabase.from("candidates").select("name").eq("id", resolved.row.candidate_id).maybeSingle()
      ]);
      runInBackground(sendVoteConfirmationEmail({
        buyerEmail: resolved.row.voter_email,
        candidateName: candidate?.name || "votre candidat",
        campaignTitle: campaign?.title || "la campagne",
        votesQty: resolved.row.quantity
      }));
    } catch (e: any) {
      console.warn("[Email] Notification acheteur (voix) échouée :", e.message);
    }
  }

  return true;
}

export async function failVoteOrder(resolved: ResolvedVoteOrder): Promise<void> {
  if (!supabase) return;
  const currentRef = String(resolved.row.transaction_ref || "");
  if (!currentRef.startsWith("PENDING-")) return;
  const newRef = currentRef.replace("PENDING-", "FAILED-");
  await supabase.from("votes").update({ transaction_ref: newRef }).eq("id", resolved.row.id);
  await supabase.from("vote_transactions").update({ status: "failed" }).eq("id", resolved.orderId);
}
