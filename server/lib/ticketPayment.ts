// Cycle de vie du champ transaction_ref d'un billet (cf. server/routes/tickets.ts) :
//
//   PENDING-…   commande créée, paiement pas encore confirmé (réserve du stock)
//   PAID-…      paiement confirmé (webhook Paystack ou validation manuelle admin)
//   FREE-…      billet gratuit, confirmé d'office à la création
//   EXPIRED-…   resté PENDING- au-delà du délai : ANNULÉ par le cron
//               (GET /api/cron/expire-pending-tickets), stock rendu à l'événement
//   FAILED-…    paiement explicitement refusé
//
// Seuls PAID- et FREE- correspondent à de l'argent réellement encaissé. Un billet PENDING-
// est une réservation en cours qui sera annulée si elle n'est pas payée ; un EXPIRED-/FAILED-
// l'a déjà été, et sa ligne subsiste jusqu'à la purge de rétention (90 jours par défaut).
//
// Compter ces billets dans un chiffre d'affaires gonfle donc un montant qui n'a jamais existé,
// et le fait ensuite disparaître silencieusement au passage du cron.
export function isPaidTicketRef(ref: unknown): boolean {
  const value = String(ref ?? "");
  return value.startsWith("PAID-") || value.startsWith("FREE-");
}

// Accepte indifféremment la forme Supabase (transaction_ref) et la forme db.json /
// frontend (transactionRef), comme le reste des helpers partagés entre les deux chemins.
export function isPaidTicket(ticket: any): boolean {
  return isPaidTicketRef(ticket?.transaction_ref ?? ticket?.transactionRef);
}
