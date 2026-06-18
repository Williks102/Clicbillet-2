import { useState, useEffect } from "react";
import { Ticket as TicketIcon, Calendar, MapPin, Download, CheckCircle2, AlertTriangle, ExternalLink, Printer, Sparkles } from "lucide-react";
import { Ticket, User } from "../types";

interface ClientDashboardProps {
  user: User;
}

export default function ClientDashboard({ user }: ClientDashboardProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = user.token ? { Authorization: `Bearer ${user.token}` } : {};

  // Fetch tickets for this user from backend
  async function fetchTickets() {
    try {
      const response = await fetch(`/api/my-tickets`, { headers: authHeaders });
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

  useEffect(() => {
    fetchTickets();
    
    const handleRefresh = () => fetchTickets();
    window.addEventListener("refresh_tickets", handleRefresh);
    return () => window.removeEventListener("refresh_tickets", handleRefresh);
  }, [user.id]);

  // Polling for pending tickets automatically
  useEffect(() => {
    const hasPending = tickets.some(t => t.paymentStatus === "pending");
    let interval: NodeJS.Timeout;
    
    if (hasPending) {
      interval = setInterval(() => {
        fetch(`/api/my-tickets`, { headers: authHeaders })
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
    // Create an isolated iframe for sandboxed iframe compatibility and cross-browser reliability
    const printFrame = document.createElement("iframe");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    document.body.appendChild(printFrame);

    const ticketHtml = document.getElementById("printable-ticket-content")?.innerHTML || "";

    const printDocument = printFrame.contentWindow?.document || printFrame.contentDocument;
    if (printDocument) {
      printDocument.open();
      printDocument.write(`
        <html>
          <head>
            <title>Pass ClicBillet - ${selectedTicket?.eventTitle || "Billet"}</title>
            <style>
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
              
              /* Theme Colors & Layout styling matching original ticket aesthetics */
              .bg-gray-50\\/70 {
                background-color: #f9fafb;
                border: 1px solid #f3f4f6;
                border-radius: 16px;
                padding: 16px;
                display: flex;
                flex-direction: column;
                align-items: center;
              }
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
              .text-orange-600 { color: #ea580c; }
              .text-amber-900 { color: #78350f; }
              .bg-amber-100 { background-color: #fef3c7; }
              .bg-blue-100 { background-color: #dbeafe; }
              .text-blue-900 { color: #1e3a8a; }
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
            </style>
          </head>
          <body>
            <div style="max-width: 360px; margin: 10px auto; border: 1px dashed #ea580c; padding: 20px; border-radius: 16px; background-color: #ffffff;">
              <div style="text-align: center; margin-bottom: 20px;">
                <span style="font-family: sans-serif; font-size: 18px; font-weight: 900; color: #111827;">
                  CLIC<span style="color: #ea580c;">BILLET</span> COUPOUN
                </span>
                <span style="display: block; font-size: 8px; font-weight: 700; letter-spacing: 0.15em; color: #9ca3af; margin-top: 2px; text-transform: uppercase;">
                  Pass de Réservation Sécurisé
                </span>
              </div>
              
              ${ticketHtml}
              
              <div style="text-align: center; font-size: 8px; color: #9ca3af; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 10px;">
                © 2026 ClicBillet CI. Réseau national de billetterie mobile décentralisé.
              </div>
            </div>
            <script>
              window.onload = function() {
                window.focus();
                window.print();
                setTimeout(function() {
                  window.parent.document.body.removeChild(window.frameElement);
                }, 1000);
              };
            </script>
          </body>
        </html>
      `);
      printDocument.close();
    }
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
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-600 text-white shadow-md shadow-orange-100 shrink-0">
          <TicketIcon className="h-6 w-6 rotate-12" />
        </div>
      </section>

      {/* Ticket List Section */}
      <section className="space-y-4">
        <h3 className="text-lg font-extrabold text-gray-900 flex items-center space-x-2">
          <TicketIcon className="h-5 w-5 text-orange-600" />
          <span>Mes Billets ({tickets.length})</span>
        </h3>

        {loading ? (
          <div className="py-12 text-center" id="tickets-loading-spinner">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
            <p className="mt-3 text-xs text-gray-500 font-semibold">Récupération des billets sécurisée...</p>
          </div>
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
                    tkt.tier === "vip" 
                      ? "bg-amber-100 text-amber-800" 
                      : "bg-blue-100 text-blue-800"
                  }`}>
                    {tkt.tier === "vip" ? "Pass VIP" : "Pass Standard"}
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

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="font-bold text-gray-400 font-mono">Qte: {tkt.quantity}</span>
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

      {/* Ticket Details & QR Code Drawer Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto backdrop-blur-xs" id="ticket-modal-overlay">
          <div className="relative w-full max-w-md my-8 rounded-3xl bg-white border border-orange-50 shadow-2xl overflow-hidden print:p-0 print:border-none print:shadow-none" id="ticket-modal-box">
            
            {/* Modal header details */}
            <div className="bg-orange-600 px-6 py-5 text-white flex justify-between items-center print:hidden">
              <span className="text-sm font-extrabold flex items-center space-x-1">
                <TicketIcon className="h-4 w-4" />
                <span>Mon Billet Securisé</span>
              </span>
              <button
                onClick={() => setSelectedTicket(null)}
                className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20 text-white transition-all text-xs font-extrabold"
              >
                Fermer
              </button>
            </div>

            {/* Simulated Printed Pass Paper */}
            <div className="p-6 md:p-8 space-y-6" id="printable-ticket-content">
              {/* Event Badge and Title */}
              <div className="text-center space-y-2">
                <span className={`inline-flex items-center space-x-1 rounded-sm px-2.5 py-0.5 text-[10px] font-black uppercase ${
                  selectedTicket.tier === "vip" 
                    ? "bg-amber-100 text-amber-900 border border-amber-200" 
                    : "bg-blue-100 text-blue-900 border border-blue-200"
                }`}>
                  <Sparkles className="h-3 w-3 text-amber-600 shrink-0" />
                  <span>{selectedTicket.tier === "vip" ? "Pass VIP" : "Pass Standard"}</span>
                </span>
                
                <h3 className="text-lg font-black text-gray-900 leading-tight">
                  {selectedTicket.eventTitle}
                </h3>
              </div>

              {/* Secure QR Code Section */}
              <div className="flex flex-col items-center justify-center space-y-2 bg-gray-50/70 py-6 rounded-2xl border border-gray-100">
                <div className="relative h-44 w-44 rounded-xl bg-white p-2 border border-gray-200 shadow-md flex items-center justify-center">
                  {selectedTicket.paymentStatus === "pending" && (
                    <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center p-3 text-center rounded-xl z-10">
                      <AlertTriangle className="h-10 w-10 text-amber-500 animate-pulse" />
                      <span className="text-xs font-extrabold text-amber-600 mt-2">Paiement En Attente</span>
                      <span className="text-[10px] text-gray-500 mt-1 leading-tight">Le QR Code sera généré dès validation.</span>
                    </div>
                  )}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(selectedTicket.qrCodeData)}`}
                    alt="Billet QR Code"
                    className={`h-40 w-40 ${selectedTicket.paymentStatus === "pending" ? 'opacity-20 grayscale blur-sm' : ''}`}
                    referrerPolicy="no-referrer"
                  />
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
                  <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase font-mono">ID: {selectedTicket.id}</p>
                  <p className="text-[9px] text-gray-400 mt-1">Présentez ce QR Code à l'entrée de l'événement.</p>
                </div>
              </div>

              {/* Metadata Details Grid */}
              <div className="grid grid-cols-2 gap-4 border-t border-dashed border-gray-200 pt-5 text-xs text-gray-700">
                <div>
                  <span className="text-gray-400 font-bold block mb-0.5">Acheteur</span>
                  <span className="font-extrabold text-gray-900 block truncate">{selectedTicket.buyerName}</span>
                  <span className="text-[10px] text-gray-400 truncate block">{selectedTicket.buyerEmail}</span>
                </div>
                <div>
                  <span className="text-gray-400 font-bold block mb-0.5">Quantité</span>
                  <span className="font-extrabold text-gray-900 font-sans block">{selectedTicket.quantity} Personne(s)</span>
                </div>
                <div>
                  <span className="text-gray-400 font-bold block mb-0.5">Date et Heure</span>
                  <span className="font-extrabold text-gray-900 block leading-tight">
                    {new Date(selectedTicket.eventDate).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric"
                    })}
                  </span>
                  <span className="text-[10px] text-gray-400 block font-semibold mt-0.5">Débute à {selectedTicket.eventTime}</span>
                </div>
                <div>
                  <span className="text-gray-400 font-bold block mb-0.5 font-sans">Lieu de l'événement</span>
                  <span className="font-extrabold text-gray-900 block leading-tight truncate" title={selectedTicket.eventVenue}>
                    {selectedTicket.eventVenue}
                  </span>
                </div>
                <div className="col-span-2 border-t border-gray-50 pt-3">
                  <div className="flex justify-between items-center text-[10px] text-gray-400 font-semibold font-mono">
                    <span>REF DE PAIEMENT: {selectedTicket.transactionRef}</span>
                    <span className="font-extrabold text-orange-600 text-xs">{selectedTicket.pricePaid.toLocaleString("fr-FR")} XOF</span>
                  </div>
                </div>
              </div>
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

          </div>
        </div>
      )}
    </div>
  );
}
