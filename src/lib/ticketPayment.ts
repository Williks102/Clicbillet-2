// Pendant côté client de server/lib/ticketPayment.ts — voir ce fichier pour le cycle de vie
// complet de transactionRef.
//
// En résumé : seuls les billets PAID- (paiement confirmé) et FREE- (billet gratuit) sont
// réellement encaissés. Un billet PENDING- est une réservation qui sera annulée par le cron
// (GET /api/cron/expire-pending-tickets) si le paiement n'arrive pas ; EXPIRED-/FAILED- l'ont
// déjà été. Les compter comme du chiffre d'affaires affiche un montant qui n'existe pas, puis
// le fait disparaître au passage du cron.
export function isPaidTicket(ticket: { transactionRef?: string | null }): boolean {
  const ref = ticket.transactionRef || "";
  return ref.startsWith("PAID-") || ref.startsWith("FREE-");
}
