import { useState, useEffect, useMemo } from "react";
import { Ticket as TicketIcon, Calendar, MapPin, Download, CheckCircle2, AlertTriangle, ExternalLink, Printer, Sparkles, Receipt, Lock, Send, Gift } from "lucide-react";
import { Ticket, TicketTransfer, User } from "../types";
import { authFetch } from "../lib/apiClient";
import { printHtmlDocument, escapeHtml } from "../lib/printDocument";
import { isVipTier, formatTierLabel } from "../lib/ticketTier";
import { buildPassTheme } from "../lib/passDesign";
import { isPaidTicket } from "../lib/ticketPayment";
import { hasEventStarted } from "../lib/eventStatus";
import { TicketListSkeleton } from "./Skeleton";
import ResponsiveSheet from "./ResponsiveSheet";
import AccountCodeBadge from "./AccountCodeBadge";

interface ClientDashboardProps {
  user: User;
}

interface BuyerOrder {
  transactionRef: string;
  purchaseDate: string;
  eventTitles: string[];
  tickets: Ticket[];
  totalAmount: number;
}

// Regroupe les billets payés par commande (transaction_ref partagé entre tous les billets
// d'un même achat) pour n'afficher/facturer qu'une fois par commande, pas par billet.
function groupPaidOrders(tickets: Ticket[]): BuyerOrder[] {
  const groups = new Map<string, Ticket[]>();
  for (const t of tickets) {
    if (!isPaidTicket(t)) continue;
    const ref = t.transactionRef || "";
    if (!groups.has(ref)) groups.set(ref, []);
    groups.get(ref)!.push(t);
  }
  return Array.from(groups.entries())
    .map(([transactionRef, tkts]) => ({
      transactionRef,
      purchaseDate: tkts[0].purchaseDate,
      eventTitles: [...new Set(tkts.map((t) => t.eventTitle))],
      tickets: tkts,
      totalAmount: tkts.reduce((sum, t) => sum + t.pricePaid, 0),
    }))
    .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
}

function buildInvoiceHtml(order: BuyerOrder, buyer: User): string {
  const rows = order.tickets
    .map(
      (t) => `
      <tr>
        <td>${escapeHtml(t.eventTitle)}</td>
        <td>${escapeHtml(formatTierLabel(t.tier))}</td>
        <td class="right">${t.pricePaid.toLocaleString("fr-FR")} FCFA</td>
      </tr>`
    )
    .join("");

  return `
    <div class="header">
      <div>
        <div class="brand">clic<span>billet</span></div>
        <p class="muted" style="margin: 4px 0 0;">Reçu d'achat de billets</p>
      </div>
      <div class="right">
        <p style="margin:0; font-weight:700;">Réf. ${escapeHtml(order.transactionRef)}</p>
        <p class="muted" style="margin:4px 0 0;">${new Date(order.purchaseDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
    </div>
    <p style="margin:0 0 4px;"><strong>Acheteur :</strong> ${escapeHtml(buyer.name)}</p>
    <p class="muted" style="margin:0 0 24px;">${escapeHtml(buyer.email)}</p>
    <table>
      <thead>
        <tr><th>Événement</th><th>Catégorie</th><th class="right">Montant</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-row grand"><span>Total payé</span><span>${order.totalAmount.toLocaleString("fr-FR")} FCFA</span></div>
    </div>
    <div class="footer">Ce reçu a été généré automatiquement par ClicBillet et confirme le paiement de cette commande.</div>
  `;
}

export default function ClientDashboard({ user }: ClientDashboardProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dashTab, setDashTab] = useState<"tickets" | "invoices" | "transferred" | "received">("tickets");
  const [transfersSent, setTransfersSent] = useState<TicketTransfer[]>([]);
  const [transfersReceived, setTransfersReceived] = useState<TicketTransfer[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [transferName, setTransferName] = useState("");
  const [transferSending, setTransferSending] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);

  // Habillage choisi par l'organisateur pour CET événement (couleurs, logo, image de fond).
  // Retombe sur le thème ClicBillet quand rien n'a été personnalisé, ou qu'une valeur stockée
  // ne passe pas la validation.
  const passTheme = useMemo(() => buildPassTheme(selectedTicket?.passDesign), [selectedTicket]);

  // Fetch tickets for this user from backend
  async function fetchTickets() {
    try {
      const response = await authFetch(`/api/my-tickets`, {});
      if (!response.ok) {
        throw new Error("Impossible de récupérer vos billets.");
      }
      const data = await response.json();
      setTickets(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }

  // Historique en lecture seule des transferts (onglets "Billets transférés"/"Mes billets
  // reçus") : indépendant de fetchTickets, un échec ici ne doit pas empêcher d'afficher les
  // billets eux-mêmes.
  async function fetchTransfers() {
    try {
      const response = await authFetch(`/api/my-transfers`, {});
      if (!response.ok) return;
      const data = await response.json();
      setTransfersSent(data.sent || []);
      setTransfersReceived(data.received || []);
    } catch (err) {
      console.error("Erreur de récupération de l'historique des transferts", err);
    }
  }

  useEffect(() => {
    fetchTickets();
    fetchTransfers();

    const handleRefresh = () => fetchTickets();
    window.addEventListener("refresh_tickets", handleRefresh);
    return () => window.removeEventListener("refresh_tickets", handleRefresh);
  }, [user.id]);

  // Repart d'un formulaire de transfert vierge à chaque ouverture/changement/fermeture du
  // billet sélectionné, plutôt que de laisser traîner la saisie d'un billet précédent.
  useEffect(() => {
    setTransferOpen(false);
    setTransferEmail("");
    setTransferName("");
    setTransferError(null);
  }, [selectedTicket?.id]);

  async function handleTransferTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTicket) return;
    setTransferSending(true);
    setTransferError(null);
    try {
      const response = await authFetch(`/api/tickets/${selectedTicket.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: transferEmail, recipientName: transferName || undefined })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Impossible de transférer ce billet.");
      }
      setTransferSuccess(`Billet transféré à ${transferEmail} !`);
      setSelectedTicket(null);
      await Promise.all([fetchTickets(), fetchTransfers()]);
    } catch (err: any) {
      setTransferError(err.message || "Impossible de transférer ce billet.");
    } finally {
      setTransferSending(false);
    }
  }

  // Polling for pending tickets automatically
  useEffect(() => {
    const hasPending = tickets.some(t => t.paymentStatus === "pending");
    let interval: NodeJS.Timeout;
    
    if (hasPending) {
      interval = setInterval(() => {
        authFetch(`/api/my-tickets`, {})
          .then(res => res.json())
          .then((data: Ticket[]) => {
            // Compare the tickets to avoid unnecessary re-renders
            const pendingBefore = tickets.filter(t => t.paymentStatus === "pending").length;
            const pendingNow = data.filter(t => t.paymentStatus === "pending").length;
            if (pendingBefore !== pendingNow) {
              setTickets(data);
              
              // If we have selected a ticket that was pending and is now paid, update selectedTicket too
              if (selectedTicket && selectedTicket.paymentStatus === "pending") {
                const refreshedSelected = data.find(t => t.id === selectedTicket.id);
                if (refreshedSelected) setSelectedTicket(refreshedSelected);
              }
            }
          })
          .catch(err => console.error("Erreur de rafraîchissement des tickets en attente", err));
      }, 3000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [tickets, selectedTicket, user.id]);

  function handlePrintTicket() {
    // Copie de travail : le calque d'image de fond est retiré avant recopie, car le document
    // imprimé le repose au niveau du cadre du pass. Le laisser ici le ferait apparaître deux
    // fois, la version recopiée ne couvrant que le bloc central (son parent positionné change).
    const source = document.getElementById("printable-ticket-content");
    const copie = source?.cloneNode(true) as HTMLElement | null;
    copie?.querySelector("#pass-background-layer")?.remove();
    const ticketHtml = copie?.innerHTML || "";

    // L'habillage est réappliqué ici parce que seul l'INTÉRIEUR du pass est recopié : les
    // styles portés par le conteneur #printable-ticket-content lui-même (fond, position
    // relative dont dépend le calque d'image) ne suivent pas l'innerHTML.
    //
    // Les valeurs viennent de buildPassTheme, qui n'accepte qu'un #RRGGBB et une URL sans
    // guillemet ni parenthèse : c'est ce qui rend sûre leur interpolation dans ces attributs
    // `style`, où l'échappement HTML ne protégerait de rien.
    const fondImprime = passTheme.backgroundImageUrl
      ? `<div style="position: absolute; inset: 0; background-image: url(${passTheme.backgroundImageUrl}); background-size: cover; background-position: center; opacity: ${passTheme.backgroundOpacity};"></div>`
      : "";

    const enTeteImprime = passTheme.logoUrl
      ? `<img src="${escapeHtml(passTheme.logoUrl)}" alt="" style="max-height: 56px; max-width: 60%; margin: 0 auto 8px; display: block; object-fit: contain;" />`
      : `<span style="font-family: sans-serif; font-size: 18px; font-weight: 900; color: ${passTheme.textColor};">
            CLIC<span style="color: ${passTheme.primaryColor};">BILLET</span> COUPOUN
          </span>`;

    const bodyHtml = `
      <div style="position: relative; max-width: 360px; margin: 10px auto; border: 1px dashed ${passTheme.primaryColor}; padding: 20px; border-radius: 16px; background-color: ${passTheme.backgroundColor}; color: ${passTheme.textColor}; overflow: hidden;">
        ${fondImprime}
        <div style="position: relative; text-align: center; margin-bottom: 20px;">
          ${enTeteImprime}
          <span style="display: block; font-size: 8px; font-weight: 700; letter-spacing: 0.15em; color: ${passTheme.mutedColor}; margin-top: 2px; text-transform: uppercase;">
            Pass de Réservation Sécurisé
          </span>
        </div>

        <div style="position: relative;">${ticketHtml}</div>

        <div style="position: relative; text-align: center; font-size: 8px; color: ${passTheme.mutedColor}; margin-top: 24px; border-top: 1px solid ${passTheme.borderColor}; padding-top: 10px;">
          © 2026 ClicBillet CI. Réseau national de billetterie mobile décentralisé.
        </div>
      </div>
    `;

    const ticketStyles = `
      /* Les fonds et couleurs du pass viennent de l'habillage de l'organisateur, posés en
         ligne sur les éléments. Sans print-color-adjust, les navigateurs les suppriment à
         l'impression (économie d'encre par défaut) et le pass ressort en noir et blanc. */
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body {
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        color: #111827;
        padding: 16px;
        margin: 0;
        background: white;
      }
      .text-center { text-align: center; }
      .space-y-2 > * + * { margin-top: 8px; }
      .space-y-6 > * + * { margin-top: 24px; }

      /* Mise en page du bloc QR : son fond et son liseré sont désormais portés en ligne par
         l'habillage, il ne reste ici que les dimensions. */
      .py-6 { padding-top: 16px; padding-bottom: 16px; }
      .rounded-2xl { border-radius: 16px; }
      .relative { position: relative; }
      .h-44 { height: 176px; }
      .w-44 { width: 176px; }
      .rounded-xl { border-radius: 12px; }
      .bg-white { background-color: #ffffff; }
      .p-2 { padding: 8px; }
      .border { border: 1px solid #e5e7eb; }
      .shadow-md { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
      .flex { display: flex; }
      .flex-col { flex-direction: column; }
      .items-center { align-items: center; }
      .justify-center { justify-content: center; }
      .text-xs { font-size: 11px; }
      .text-sm { font-size: 13px; }
      .text-[10px] { font-size: 9px; }
      .text-[9px] { font-size: 8px; }
      .text-lg { font-size: 16px; }
      .font-black { font-weight: 900; }
      .font-bold { font-weight: 700; }
      .font-extrabold { font-weight: 800; }
      .tracking-widest { letter-spacing: 0.1em; }
      .uppercase { text-transform: uppercase; }
      .font-mono { font-family: monospace; }
      .grid { display: grid; }
      .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .gap-4 { gap: 12px; }
      .border-t { border-top: 1px solid #e5e7eb; }
      .border-dashed { border-style: dashed; }
      .pt-5 { padding-top: 16px; }
      .col-span-2 { grid-column: span 2 / span 2; }
      /* Les couleurs du pass (accent, texte, pastille du tarif) ne sont plus déclarées ici :
         elles viennent de l'habillage de l'organisateur et voyagent en ligne avec le HTML
         recopié. Les figer en dur ici les écraserait pour tous les événements. */
      .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      img { max-width: 100%; display: block; margin: 0 auto; }

      @media print {
        body { padding: 0; }
        .print\\:hidden { display: none !important; }
      }
    `;

    printHtmlDocument(`Pass ClicBillet - ${selectedTicket?.eventTitle || "Billet"}`, bodyHtml, ticketStyles);
  }

  return (
    <div className="space-y-8 py-6" id="client-dashboard-container">
      {/* Welcome banner */}
      <section className="rounded-2xl bg-orange-50 p-6 border border-orange-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-gray-900">
            Bienvenue, {user.name} !
          </h2>
          <p className="mt-1 text-xs text-gray-500 font-medium">
            Retrouvez tous vos tickets d'événements et présentez votre QR Code aux points de contrôle d'accès.
          </p>
          <AccountCodeBadge code={user.publicCode} className="mt-4" />
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-600 text-white shadow-md shadow-orange-100 shrink-0">
          <TicketIcon className="h-6 w-6 rotate-12" />
        </div>
      </section>

      {transferSuccess && (
        <div
          id="transfer-success-banner"
          className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-800"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
            <span>{transferSuccess}</span>
          </div>
          <button onClick={() => setTransferSuccess(null)} className="text-xs font-black text-emerald-600 hover:text-emerald-800">
            Fermer
          </button>
        </div>
      )}

      {/* Sub-tabs: Billets / Factures / Transférés / Reçus */}
      <div className="flex flex-wrap gap-2 rounded-xl bg-gray-50 p-1.5 w-fit" id="client-dashboard-subtabs">
        <button
          onClick={() => setDashTab("tickets")}
          className={`flex items-center space-x-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            dashTab === "tickets" ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <TicketIcon className="h-3.5 w-3.5" />
          <span>Mes Billets</span>
        </button>
        <button
          onClick={() => setDashTab("invoices")}
          className={`flex items-center space-x-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            dashTab === "invoices" ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Receipt className="h-3.5 w-3.5" />
          <span>Mes Factures</span>
        </button>
        <button
          id="dashtab-transferred-btn"
          onClick={() => setDashTab("transferred")}
          className={`flex items-center space-x-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            dashTab === "transferred" ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Send className="h-3.5 w-3.5" />
          <span>Billets Transférés</span>
        </button>
        <button
          id="dashtab-received-btn"
          onClick={() => setDashTab("received")}
          className={`flex items-center space-x-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            dashTab === "received" ? "bg-white text-orange-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Gift className="h-3.5 w-3.5" />
          <span>Mes Billets Reçus</span>
        </button>
      </div>

      {dashTab === "invoices" && (
        <section className="space-y-4" id="client-invoices-section">
          {(() => {
            const orders = groupPaidOrders(tickets);
            return orders.length > 0 ? (
              <div className="space-y-3">
                {orders.map((order) => (
                  <div
                    key={order.transactionRef}
                    id={`invoice-row-${order.transactionRef}`}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 truncate">{order.eventTitles.join(", ")}</p>
                      <p className="mt-0.5 text-xs text-gray-400 font-mono">
                        {new Date(order.purchaseDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                        {" · "}Réf. {order.transactionRef}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-black text-orange-600">{order.totalAmount.toLocaleString("fr-FR")} FCFA</span>
                      <button
                        onClick={() => printHtmlDocument(`Facture ${order.transactionRef}`, buildInvoiceHtml(order, user))}
                        className="flex items-center space-x-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>PDF</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-gray-100 py-16 text-center">
                <Receipt className="mx-auto h-12 w-12 text-gray-300" />
                <h4 className="mt-4 text-base font-bold text-gray-900">Aucune facture pour le moment</h4>
                <p className="mt-2 text-xs text-gray-500">Vos reçus d'achat apparaîtront ici dès votre premier paiement confirmé.</p>
              </div>
            );
          })()}
        </section>
      )}

      {dashTab === "tickets" && (
      <>
      {/* Ticket List Section */}
      <section className="space-y-4">
        <h3 className="text-lg font-extrabold text-gray-900 flex items-center space-x-2">
          <TicketIcon className="h-5 w-5 text-orange-600" />
          <span>Mes Billets ({tickets.length})</span>
        </h3>

        {loading ? (
          <TicketListSkeleton id="tickets-loading-spinner" />
        ) : error ? (
          <div className="rounded-xl bg-red-50 p-4 text-xs font-semibold text-red-600 border border-red-100">
            {error}
          </div>
        ) : tickets.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tickets.map((tkt) => (
              <div
                key={tkt.id}
                id={`ticket-card-${tkt.id}`}
                onClick={() => setSelectedTicket(tkt)}
                className="group cursor-pointer overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md active:scale-98"
              >
                <div className="flex justify-between items-start">
                  <span className={`inline-flex items-center space-x-0.5 rounded-md px-2 py-0.5 text-[9px] font-extrabold uppercase ${
                    isVipTier(tkt.tier)
                      ? "bg-amber-100 text-amber-800"
                      : "bg-blue-100 text-blue-800"
                  }`}>
                    Pass {formatTierLabel(tkt.tier)}
                  </span>

                  <span className={`inline-flex items-center text-xs font-bold ${
                    tkt.paymentStatus === "pending" ? "text-amber-500" : tkt.scanned ? "text-gray-400" : "text-green-600"
                  }`}>
                    <span className={`mr-1 h-1.5 w-1.5 rounded-full ${tkt.paymentStatus === "pending" ? "bg-amber-500" : tkt.scanned ? "bg-gray-400" : "bg-green-500"}`} />
                    {tkt.paymentStatus === "pending" ? "En attente" : tkt.scanned ? "Scanné" : "Valide"}
                  </span>
                </div>

                <h4 className="mt-4 font-black text-gray-950 line-clamp-1 group-hover:text-orange-600 transition-colors">
                  {tkt.eventTitle}
                </h4>

                <div className="mt-4 space-y-1 text-xs text-gray-500">
                  <div className="flex items-center space-x-1">
                    <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span>
                      {new Date(tkt.eventDate).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric"
                      })} à {tkt.eventTime}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span className="truncate">{tkt.eventVenue}</span>
                  </div>
                </div>

                {/* Perforation line simulation */}
                <div className="my-4 flex items-center justify-between" aria-hidden="true">
                  <div className="h-3 w-3 -ml-6.5 rounded-full bg-gray-50 border-r border-gray-100" />
                  <div className="flex-1 border-t border-dashed border-gray-100" />
                  <div className="h-3 w-3 -mr-6.5 rounded-full bg-gray-50 border-l border-gray-100" />
                </div>

                <div className="flex items-center justify-end text-xs pt-1">
                  <span className="font-extrabold text-orange-600">Afficher le pass &rarr;</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-gray-100 py-16 text-center" id="no-tickets-view">
            <TicketIcon className="mx-auto h-12 w-12 text-gray-300" />
            <h4 className="mt-4 text-base font-bold text-gray-900">Aucun billet acheté</h4>
            <p className="mt-2 text-xs text-gray-500">Parcourez nos événements du moment pour acheter votre premier ticket !</p>
          </div>
        )}
      </section>
      </>
      )}

      {dashTab === "transferred" && (
        <section className="space-y-4" id="client-transfers-sent-section">
          <h3 className="text-lg font-extrabold text-gray-900 flex items-center space-x-2">
            <Send className="h-5 w-5 text-orange-600" />
            <span>Billets Transférés ({transfersSent.length})</span>
          </h3>
          {transfersSent.length > 0 ? (
            <div className="space-y-3">
              {transfersSent.map((t) => (
                <div key={t.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">{t.eventTitle}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      Transféré à <span className="font-semibold text-gray-600">{t.toName}</span> ({t.toEmail})
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400 font-mono">
                      {new Date(t.transferredAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <span className="shrink-0 font-black text-orange-600 text-sm">{t.pricePaid.toLocaleString("fr-FR")} FCFA</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-gray-100 py-16 text-center">
              <Send className="mx-auto h-12 w-12 text-gray-300" />
              <h4 className="mt-4 text-base font-bold text-gray-900">Aucun billet transféré</h4>
              <p className="mt-2 text-xs text-gray-500">Les billets que vous cédez à quelqu'un d'autre apparaîtront ici.</p>
            </div>
          )}
        </section>
      )}

      {dashTab === "received" && (
        <section className="space-y-4" id="client-transfers-received-section">
          <h3 className="text-lg font-extrabold text-gray-900 flex items-center space-x-2">
            <Gift className="h-5 w-5 text-orange-600" />
            <span>Mes Billets Reçus ({transfersReceived.length})</span>
          </h3>
          {transfersReceived.length > 0 ? (
            <div className="space-y-3">
              {transfersReceived.map((t) => (
                <div key={t.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">{t.eventTitle}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      Reçu de <span className="font-semibold text-gray-600">{t.fromName}</span> ({t.fromEmail})
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400 font-mono">
                      {new Date(t.transferredAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <span className="shrink-0 font-black text-orange-600 text-sm">{t.pricePaid.toLocaleString("fr-FR")} FCFA</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-gray-100 py-16 text-center">
              <Gift className="mx-auto h-12 w-12 text-gray-300" />
              <h4 className="mt-4 text-base font-bold text-gray-900">Aucun billet reçu</h4>
              <p className="mt-2 text-xs text-gray-500">Les billets que quelqu'un vous transfère apparaîtront ici, retrouvables aussi dans "Mes Billets".</p>
            </div>
          )}
        </section>
      )}

      {/* Ticket Details & QR Code Drawer Modal */}
      {selectedTicket && (
        <ResponsiveSheet
          id="ticket-modal-overlay"
          panelId="ticket-modal-box"
          onClose={() => setSelectedTicket(null)}
          overlayClassName="sm:overflow-y-auto"
          panelClassName="max-w-md sm:my-8 border border-orange-50 overflow-x-hidden overflow-y-auto max-h-[92vh] sm:max-h-none print:p-0 print:border-none print:shadow-none"
        >
            {/* Modal header details */}
            <div
              className="px-6 py-5 flex justify-between items-center print:hidden"
              style={{ backgroundColor: passTheme.primaryColor, color: passTheme.onPrimaryColor }}
            >
              <span className="text-sm font-extrabold flex items-center space-x-1">
                <TicketIcon className="h-4 w-4" />
                <span>Mon Billet Securisé</span>
              </span>
              <button
                onClick={() => setSelectedTicket(null)}
                className="rounded-lg bg-black/10 p-1.5 hover:bg-black/20 transition-all text-xs font-extrabold"
                style={{ color: passTheme.onPrimaryColor }}
              >
                Fermer
              </button>
            </div>

            {/* Simulated Printed Pass Paper.
                Les styles de l'habillage sont posés EN LIGNE, et non via des classes : le
                bouton "Télécharger PDF" recopie l'innerHTML de ce bloc dans un document
                d'impression isolé (cf. handlePrintTicket), qui n'a pas la feuille Tailwind de
                l'application. Seul l'inline suit. */}
            <div
              className="relative p-6 md:p-8 space-y-6"
              id="printable-ticket-content"
              style={{ backgroundColor: passTheme.backgroundColor, color: passTheme.textColor }}
            >
              {/* Image de fond, atténuée : le QR code et les mentions doivent rester lisibles,
                  quelle que soit l'image choisie. */}
              {passTheme.backgroundImageUrl && (
                <div
                  id="pass-background-layer"
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundImage: `url(${passTheme.backgroundImageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    opacity: passTheme.backgroundOpacity,
                    pointerEvents: "none"
                  }}
                />
              )}

              {/* Event Badge and Title */}
              <div className="relative text-center space-y-2">
                {passTheme.logoUrl && (
                  <img
                    src={passTheme.logoUrl}
                    alt=""
                    style={{ maxHeight: "56px", maxWidth: "60%", margin: "0 auto 10px", display: "block", objectFit: "contain" }}
                  />
                )}
                <span
                  className="inline-flex items-center space-x-1 rounded-sm px-2.5 py-0.5 text-[10px] font-black uppercase"
                  style={{ backgroundColor: passTheme.primaryColor, color: passTheme.onPrimaryColor }}
                >
                  {isVipTier(selectedTicket.tier) && <Sparkles className="h-3 w-3 shrink-0" />}
                  <span>Pass {formatTierLabel(selectedTicket.tier)}</span>
                </span>

                <h3 className="text-lg font-black leading-tight" style={{ color: passTheme.textColor }}>
                  {selectedTicket.eventTitle}
                </h3>
              </div>

              {/* Secure QR Code Section.
                  Le cadre du QR reste blanc quel que soit le thème : un lecteur optique a
                  besoin du contraste noir sur blanc, un fond sombre le rendrait illisible. */}
              <div
                className="relative flex flex-col items-center justify-center space-y-2 py-6 rounded-2xl"
                style={{ backgroundColor: passTheme.surfaceColor, border: `1px solid ${passTheme.borderColor}` }}
              >
                <div className="relative h-44 w-44 rounded-xl bg-white p-2 border border-gray-200 shadow-md flex items-center justify-center">
                  {selectedTicket.paymentStatus === "pending" && (
                    <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center p-3 text-center rounded-xl z-10">
                      <AlertTriangle className="h-10 w-10 text-amber-500 animate-pulse" />
                      <span className="text-xs font-extrabold text-amber-600 mt-2">Paiement En Attente</span>
                      <span className="text-[10px] text-gray-500 mt-1 leading-tight">Le QR Code sera généré dès validation.</span>
                    </div>
                  )}
                  {selectedTicket.paymentStatus !== "pending" && !selectedTicket.qrCodeData ? (
                    <div className="flex flex-col items-center justify-center p-3 text-center" id="qr-locked-view">
                      <Lock className="h-10 w-10 text-gray-400" />
                      <span className="text-xs font-extrabold text-gray-600 mt-2">QR Code verrouillé</span>
                      <span className="text-[10px] text-gray-400 mt-1 leading-tight">
                        Disponible à partir du{" "}
                        {selectedTicket.qrUnlocksAt
                          ? new Date(selectedTicket.qrUnlocksAt).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
                          : "quelques heures avant l'événement"}
                      </span>
                    </div>
                  ) : (
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(selectedTicket.qrCodeData || "")}`}
                      alt="Billet QR Code"
                      className={`h-40 w-40 ${selectedTicket.paymentStatus === "pending" ? 'opacity-20 grayscale blur-sm' : ''}`}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  {selectedTicket.scanned && (
                    <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center p-3 text-center">
                      <AlertTriangle className="h-10 w-10 text-red-500 animate-bounce" />
                      <span className="text-xs font-extrabold text-red-600 mt-1">Ticket Déjà Scanné</span>
                      <span className="text-[10px] text-gray-400 mt-0.5">
                        {new Date(selectedTicket.scannedAt || "").toLocaleString("fr-FR")}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-black tracking-widest uppercase font-mono" style={{ color: passTheme.mutedColor }}>ID: {selectedTicket.id}</p>
                  <p className="text-[9px] mt-1" style={{ color: passTheme.mutedColor }}>
                    {selectedTicket.qrCodeData
                      ? "Présentez ce QR Code à l'entrée de l'événement."
                      : "Revenez sur cette page le jour J pour afficher votre QR Code."}
                  </p>
                </div>
              </div>

              {/* Metadata Details Grid */}
              <div
                className="relative grid grid-cols-2 gap-4 pt-5 text-xs"
                style={{ borderTop: `1px dashed ${passTheme.borderColor}`, color: passTheme.textColor }}
              >
                <div>
                  <span className="font-bold block mb-0.5" style={{ color: passTheme.mutedColor }}>Acheteur</span>
                  <span className="font-extrabold block truncate" style={{ color: passTheme.textColor }}>{selectedTicket.buyerName}</span>
                  <span className="text-[10px] truncate block" style={{ color: passTheme.mutedColor }}>{selectedTicket.buyerEmail}</span>
                </div>
                <div>
                  <span className="font-bold block mb-0.5" style={{ color: passTheme.mutedColor }}>Quantité</span>
                  <span className="font-extrabold font-sans block" style={{ color: passTheme.textColor }}>{selectedTicket.quantity} Personne(s)</span>
                </div>
                <div>
                  <span className="font-bold block mb-0.5" style={{ color: passTheme.mutedColor }}>Date et Heure</span>
                  <span className="font-extrabold block leading-tight" style={{ color: passTheme.textColor }}>
                    {new Date(selectedTicket.eventDate).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric"
                    })}
                  </span>
                  <span className="text-[10px] block font-semibold mt-0.5" style={{ color: passTheme.mutedColor }}>Débute à {selectedTicket.eventTime}</span>
                </div>
                <div>
                  <span className="font-bold block mb-0.5 font-sans" style={{ color: passTheme.mutedColor }}>Lieu de l'événement</span>
                  <span className="font-extrabold block leading-tight truncate" title={selectedTicket.eventVenue} style={{ color: passTheme.textColor }}>
                    {selectedTicket.eventVenue}
                  </span>
                </div>
                <div className="col-span-2 pt-3" style={{ borderTop: `1px solid ${passTheme.borderColor}` }}>
                  <div className="flex justify-between items-center text-[10px] font-semibold font-mono" style={{ color: passTheme.mutedColor }}>
                    <span>REF DE PAIEMENT: {selectedTicket.transactionRef}</span>
                    <span className="font-extrabold text-xs" style={{ color: passTheme.primaryColor }}>{selectedTicket.pricePaid.toLocaleString("fr-FR")} XOF</span>
                  </div>
                </div>
              </div>

              {/* Transfert officiel du billet : alternative légitime au partage d'une capture
                  d'écran, seulement pour un billet payé, pas encore scanné, événement à venir. */}
              {selectedTicket.paymentStatus !== "pending" && !selectedTicket.scanned && !hasEventStarted({ date: selectedTicket.eventDate, time: selectedTicket.eventTime }) && (
                <div className="relative pt-5 print:hidden" id="ticket-transfer-section" style={{ borderTop: `1px dashed ${passTheme.borderColor}` }}>
                  {!transferOpen ? (
                    <button
                      id="open-transfer-form-btn"
                      onClick={() => setTransferOpen(true)}
                      className="flex w-full items-center justify-center space-x-1.5 rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 active:scale-95"
                    >
                      <Send className="h-3.5 w-3.5 text-orange-600" />
                      <span>Transférer ce billet à quelqu'un d'autre</span>
                    </button>
                  ) : (
                    <form onSubmit={handleTransferTicket} className="space-y-3" id="transfer-ticket-form">
                      <p className="text-[11px] text-gray-500">
                        L'ancien QR code sera immédiatement invalidé — le destinataire recevra un nouveau billet par e-mail.
                      </p>
                      {transferError && (
                        <div className="rounded-lg bg-red-50 p-2.5 text-[11px] font-semibold text-red-600 border border-red-100" id="transfer-error-alert">
                          {transferError}
                        </div>
                      )}
                      <input
                        type="email"
                        required
                        placeholder="Email du destinataire"
                        value={transferEmail}
                        onChange={(e) => setTransferEmail(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                      />
                      <input
                        type="text"
                        placeholder="Nom du destinataire (optionnel)"
                        maxLength={100}
                        value={transferName}
                        onChange={(e) => setTransferName(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setTransferOpen(false)}
                          className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                        >
                          Annuler
                        </button>
                        <button
                          type="submit"
                          disabled={transferSending}
                          className="flex flex-1 items-center justify-center space-x-1.5 rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-black text-white hover:bg-orange-700 disabled:opacity-60"
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>{transferSending ? "Envoi..." : "Confirmer le transfert"}</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>

            {/* PDF print actions trigger */}
            <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex flex-col sm:flex-row gap-2 print:hidden justify-end">
              <button
                onClick={handlePrintTicket}
                id="print-ticket-action-btn"
                disabled={selectedTicket.paymentStatus === "pending"}
                className={`flex items-center justify-center space-x-1.5 rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold ${
                  selectedTicket.paymentStatus === "pending"
                    ? "bg-gray-50 text-gray-400 cursor-not-allowed opacity-50"
                    : "bg-white text-gray-700 hover:bg-gray-50 active:scale-95"
                }`}
              >
                <Download className="h-4 w-4 text-gray-400" />
                <span>Télécharger (PDF) / Imprimer</span>
              </button>
              <button
                onClick={() => setSelectedTicket(null)}
                className="flex items-center justify-center rounded-xl bg-orange-600 px-4 py-2 text-xs font-black text-white hover:bg-orange-700 active:scale-95"
              >
                Tout est bon !
              </button>
            </div>
        </ResponsiveSheet>
      )}
    </div>
  );
}
