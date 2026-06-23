import React, { useState } from "react";
import { X, Check, ArrowRight, ShieldCheck, CreditCard, MessageSquare, Ticket, Sparkles, Smartphone } from "lucide-react";
import { Event, User, PaymentMethod, PaymentDetails } from "../types";
import ResponsiveSheet from "./ResponsiveSheet";
import { GuestInfo } from "./GuestOrAuthModal";

interface CheckoutModalProps {
  event: Event;
  user: User | null;
  guestInfo?: GuestInfo;
  onClose: () => void;
  onSuccess: (tickets: any[]) => void;
  onOpenAuth: () => void;
}

const MAX_PER_TIER = 10;
const MAX_TOTAL_PER_ORDER = 20;

export default function CheckoutModal({ event, user, guestInfo, onClose, onSuccess, onOpenAuth }: CheckoutModalProps) {
  const isGuest = !user && !!guestInfo;
  const [step, setStep] = useState<"configure" | "details" | "processing" | "success">("configure");
  const activeTicketTypes = (event.ticketTypes && event.ticketTypes.length > 0)
    ? event.ticketTypes
    : [{ name: "Standard", price: event.price }, { name: "VIP", price: event.price * 2 }];

  // Panier : quantité indépendante par type de billet, plusieurs types peuvent être
  // sélectionnés simultanément dans la même commande (ex: 2 Standard + 1 VIP).
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>("orange_money");
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  // Payment details state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Computed values
  const selectedItems = activeTicketTypes
    .map((t) => ({ name: t.name, price: t.price, qty: quantities[t.name] || 0 }))
    .filter((item) => item.qty > 0);
  const totalQuantity = selectedItems.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = selectedItems.reduce((sum, item) => sum + item.price * item.qty, 0);

  function adjustQuantity(tierName: string, delta: number) {
    setQuantities((prev) => {
      const current = prev[tierName] || 0;
      const currentTotal = Object.values(prev).reduce((sum, q) => sum + q, 0);
      if (delta > 0 && (current >= MAX_PER_TIER || currentTotal >= MAX_TOTAL_PER_ORDER)) {
        return prev;
      }
      const next = Math.max(0, current + delta);
      return { ...prev, [tierName]: next };
    });
  }

  // Gateways configurations with logo text & primary CSS theme styles
  const GATEWAYS = [
    { id: "orange_money" as PaymentMethod, name: "Orange Money", desc: "Mobile Money", color: "border-orange-500 hover:bg-orange-50/20 text-orange-600 bg-orange-500/5" },
    { id: "mtn_momo" as PaymentMethod, name: "MTN MoMo", desc: "MoMo Pay", color: "border-amber-400 hover:bg-amber-50/20 text-amber-600 bg-amber-400/5" },
    { id: "moov_money" as PaymentMethod, name: "Moov Money", desc: "Flooz Pay", color: "border-teal-500 hover:bg-teal-50/20 text-teal-600 bg-teal-500/5" },
    { id: "wave" as PaymentMethod, name: "Wave Money", desc: "Wave App", color: "border-sky-500 hover:bg-sky-50/20 text-sky-600 bg-sky-500/5" },
    { id: "card" as PaymentMethod, name: "Carte Bancaire", desc: "Visa / Mastercard", color: "border-black hover:bg-gray-50 text-gray-900 bg-gray-500/5" },
  ];

  function handleGoToDetails() {
    if (totalQuantity === 0) {
      setError("Veuillez sélectionner au moins un billet.");
      return;
    }
    if (!user && !guestInfo) {
      onOpenAuth();
      return;
    }
    setError(null);
    setStep("details");
  }

  async function handleConfirmPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Dynamic field validation before processing starts
    if (method !== "card" && method !== "wave") {
      // Mobile money number must be valid 10-digit number
      const numOnly = phoneNumber.replace(/\s+/g, "");
      if (numOnly.length < 8) {
        setError("Veuillez saisir un numéro de téléphone Mobile Money valide.");
        return;
      }
    }

    if (method === "card") {
      if (!cardName || cardNumber.length < 12 || !expiry || cvv.length < 3) {
        setError("Veuillez vérifier vos informations bancaires de paiement.");
        return;
      }
    }

    setStep("processing");
    const devSimulateHeaders = {
      "Content-Type": "application/json",
      ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
    };

    const buyerEmail = user?.email ?? guestInfo?.email ?? "";
    const buyerName = user?.name ?? (guestInfo?.email.split("@")[0] ?? "Invité");
    const buyerPhone = isGuest ? (guestInfo?.phone ?? phoneNumber) : phoneNumber;

    // Initiate backend express purchase sequence
    const paymentDetails: PaymentDetails = {
      method,
      phoneNumber: buyerPhone,
      otp,
      cardName,
      cardNumber,
      expiry,
      cvv
    };

    try {
      // Simulate slight processing network delay for UX suspense
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const payload = {
        eventId: event.id,
        buyerId: user?.id ?? null,
        buyerName,
        buyerEmail,
        guestPhone: isGuest ? guestInfo?.phone : undefined,
        items: selectedItems.map((item) => ({ tier: item.name.toLowerCase(), quantity: item.qty })),
        paymentDetails
      };

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: devSimulateHeaders,
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Une erreur est survenue lors de la validation du paiement.");
      }

      // INTEGRATION PAIEMENT PRO (CÔTE D'IVOIRE)
      // diagContext garde la trace de ce qui a été tenté, pour pouvoir comprendre
      // un échec a posteriori (console du navigateur) sans avoir à reproduire le bug.
      const diagContext: Record<string, unknown> = { orderId: data.orderId, method };
      let paymentFailureReason: string | null = null;

      try {
        const merchantId = (import.meta as any).env.VITE_PAIEMENT_PRO_MERCHANT_ID || "ID_MARCHAND_DEMO";
        const LibPaiementPro = (window as any).PaiementPro;
        diagContext.merchantId = merchantId;
        diagContext.sdkLoaded = !!LibPaiementPro;
        diagContext.sdkIsFallback = !!LibPaiementPro?.isFallback;

        if (LibPaiementPro) {
          console.log("[PaiementPro] Initialisation du SDK avec l'ID marchand :", merchantId);
          const pPro = new LibPaiementPro(merchantId);

          pPro.amount = totalPrice;

          // Mappage des canaux vers les codes officiels de Côte d'Ivoire (CI)
          const channelMapping: Record<string, string> = {
            orange_money: "OMCIV2",
            mtn_momo: "MOMOCI",
            moov_money: "FLOOZ",
            wave: "WAVECI",
            card: "CARD"
          };
          pPro.channel = channelMapping[method] || "WAVECI";

          // Référence de la commande (peut regrouper plusieurs types de billets)
          pPro.referenceNumber = data.orderId || `ORD-${Date.now()}`;
          pPro.customerEmail = buyerEmail || "customer@example.com";

          const nameParts = buyerName.trim().split(/\s+/);
          pPro.customerLastname = nameParts[0] || "Client";
          pPro.customerFirstName = nameParts.slice(1).join(" ") || "Billet";

          pPro.customerPhoneNumber = buyerPhone || "0700000000";
          pPro.description = `${selectedItems.map((item) => `${item.qty}x ${item.name}`).join(", ")} - ${event.title}`;

          pPro.notificationURL = data.notificationUrl || `${window.location.origin}/api/payment/callback`;
          pPro.returnURL = `${window.location.origin}/?payment_success=true&order_id=${data.orderId}`;
          pPro.returnContext = JSON.stringify({ orderId: data.orderId, userId: user?.id ?? null, guestEmail: isGuest ? buyerEmail : null });

          try {
            await pPro.getUrlPayment();
          } catch (callErr: any) {
            // Le SDK PaiementPro échoue silencieusement en cas de coupure réseau ou de
            // réponse non-JSON du gateway : on capture explicitement pour le diagnostic.
            diagContext.getUrlPaymentError = callErr?.message || String(callErr);
            console.error("[PaiementPro] Échec de l'appel getUrlPayment()", diagContext, callErr);
            throw new Error("La passerelle de paiement n'a pas répondu. Réessayez dans quelques instants.");
          }

          diagContext.pProSuccess = pPro.success;
          diagContext.pProUrl = pPro.url;

          if (pPro.success && pPro.url) {
            console.log("[PaiementPro] Lien de paiement généré :", pPro.url);
            setPaymentUrl(pPro.url);

            // Rediriger la page courante vers la passerelle de paiement
            window.location.href = pPro.url;
            return; // on arrête le JS ici puisque l'on quitte la page
          }

          console.error("[PaiementPro] Initialisation refusée par la passerelle (success=false).", diagContext);
          paymentFailureReason = "La passerelle de paiement a refusé d'initialiser la transaction. Vérifiez vos informations ou réessayez.";
        } else {
          console.error("[PaiementPro] SDK non chargé globalement dans l'index.html.", diagContext);
          paymentFailureReason = "Le module de paiement n'a pas pu être chargé (connexion réseau ?). Veuillez réessayer.";
        }
      } catch (sdkErr: any) {
        console.error("[PaiementPro SDK Integration Error]", diagContext, sdkErr);
        paymentFailureReason = sdkErr?.message || "Une erreur technique est survenue lors de l'initialisation du paiement.";
      }

      // Le SDK n'a pas pu rediriger vers une vraie passerelle de paiement : on tente le
      // déblocage de secours réservé au développement (route 404 en production, par design
      // anti-fraude — cf. /api/dev/simulate-payment). On n'affiche un succès que si cet appel
      // confirme réellement le billet ; sinon on remonte l'erreur à l'utilisateur.
      try {
        const simRes = await fetch("/api/dev/simulate-payment", {
          method: "POST",
          headers: devSimulateHeaders,
          body: JSON.stringify({ referenceNumber: data.orderId })
        });

        if (simRes.ok) {
          window.dispatchEvent(new CustomEvent("refresh_tickets"));
          paymentFailureReason = null;
        } else {
          const simBody = await simRes.text().catch(() => "");
          console.error("[Simulation paiement] Refusée par le serveur", { status: simRes.status, simBody, ...diagContext });
        }
      } catch (simErr) {
        console.error("[Simulation paiement] Erreur réseau", diagContext, simErr);
      }

      if (paymentFailureReason) {
        setError(paymentFailureReason);
        setStep("details");
        return;
      }

      // Checkout Success! Go to step 4
      setStep("success");
      onSuccess(data.tickets);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erreur de connexion.");
      setStep("details");
    }
  }

  return (
    <ResponsiveSheet
      id="checkout-modal-overlay"
      panelId="checkout-modal-panel"
      onClose={onClose}
      panelClassName="max-w-lg overflow-hidden border border-gray-100 flex flex-col max-h-[92vh] sm:max-h-none"
    >
        {/* Header bar titles */}
        <div className="flex items-center justify-between border-b border-gray-50 bg-gray-50/50 px-6 py-4">
          <div className="flex items-center space-x-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-white font-extrabold rotate-6">
              <Ticket className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-900 leading-none">Achat de Ticket Securisé</h3>
              <p className="text-[10px] text-gray-400 font-semibold mt-0.5">{event.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-white p-1 border border-gray-100 text-gray-400 hover:text-gray-600 transition shadow-xs active:scale-95"
            id="close-checkout-btn"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step-by-Step interactive areas */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 max-h-[70vh]">
          {error && step !== "processing" && (
            <div className="rounded-xl bg-red-50 p-3.5 text-xs font-semibold text-red-600 border border-red-100">
              {error}
            </div>
          )}

          {step === "configure" && (
            <div className="space-y-6" id="checkout-configure-step">
              {/* Panier : un stepper indépendant par type de billet, plusieurs types
                  peuvent être sélectionnés en même temps dans la même commande. */}
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-700 block">Choisissez vos Billets</label>
                <p className="text-[10px] text-gray-400 font-medium">Maximum {MAX_PER_TIER} par type, {MAX_TOTAL_PER_ORDER} au total par commande.</p>
                <div className="space-y-2">
                  {activeTicketTypes.map((t, idx) => {
                    const qty = quantities[t.name] || 0;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                          qty > 0
                            ? "bg-orange-50/50 border-orange-500 ring-1 ring-orange-500"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <div>
                          <span className={`text-[11px] font-black block ${qty > 0 ? "text-orange-700" : "text-gray-900"}`}>{t.name}</span>
                          <span className="text-[10px] font-bold block mt-0.5 text-gray-500">{t.price.toLocaleString("fr-FR")} XOF</span>
                        </div>
                        <div className="flex items-center space-x-3">
                          <button
                            type="button"
                            onClick={() => adjustQuantity(t.name, -1)}
                            disabled={qty === 0}
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 font-bold hover:bg-gray-100 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            -
                          </button>
                          <span className="w-5 text-center text-sm font-extrabold text-gray-950 font-sans">{qty}</span>
                          <button
                            type="button"
                            onClick={() => adjustQuantity(t.name, 1)}
                            disabled={qty >= MAX_PER_TIER || totalQuantity >= MAX_TOTAL_PER_ORDER}
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 font-bold hover:bg-gray-100 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Choose Payment Operator Gateway */}
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-700 block">Choisissez votre Moyen de Paiement</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {GATEWAYS.map((gw) => (
                    <button
                      key={gw.id}
                      onClick={() => setMethod(gw.id)}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                        method === gw.id
                          ? `${gw.color} ring-1 ring-orange-500 border-orange-500`
                          : "border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
                      }`}
                    >
                      <Smartphone className="h-4 w-4 mb-1 text-gray-400" />
                      <span className="text-[11px] font-black block">{gw.name}</span>
                      <span className="text-[8px] text-gray-400 font-bold block mt-0.5">{gw.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                <div>
                  <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">Total à payer</span>
                  <span className="text-xl font-black text-orange-600 font-sans">{totalPrice.toLocaleString("fr-FR")} F CFA</span>
                </div>
                <button
                  onClick={handleGoToDetails}
                  className="flex items-center space-x-1.5 rounded-xl bg-orange-600 px-6 py-3.5 text-xs font-black text-white hover:bg-orange-700 transition shadow-md shadow-orange-100 active:scale-95"
                  id="checkout-proceed-btn"
                >
                  <span>Continuer</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === "details" && (
            <form onSubmit={handleConfirmPayment} className="space-y-4" id="checkout-details-step">
              <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100/30 space-y-1.5 text-xs mb-3">
                {selectedItems.map((item) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <span className="text-gray-500 font-semibold uppercase font-mono">{item.name} × {item.qty}</span>
                    <span className="font-extrabold text-orange-650">{(item.price * item.qty).toLocaleString("fr-FR")} XOF</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1.5 border-t border-orange-100/60">
                  <span className="text-gray-500 font-semibold uppercase font-mono">Total</span>
                  <span className="text-sm font-extrabold text-orange-650">{totalPrice.toLocaleString("fr-FR")} XOF</span>
                </div>
              </div>

              {/* Mobile Mobile Inputs (Orange Money, MTN, Moov, Wave) */}
              {method !== "card" ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-700">Numéro de téléphone Mobile Money</label>
                    <div className="relative">
                      <span className="absolute top-1/2 left-3 text-xs font-extrabold text-gray-500 -translate-y-1/2">+225</span>
                      <input
                        type="tel"
                        required
                        placeholder="07 00 00 00 00 (Format Côte d'Ivoire)"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-14 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 block font-semibold mt-0.5">Saisissez votre numéro associé au compte {method === "orange_money" ? "Orange Money" : method === "mtn_momo" ? "MTN Money" : method === "moov_money" ? "Moov Money" : "Wave"}.</span>
                  </div>

                  {/* Orange Money specifics (removed OTP by user request) */}
                  {method === "orange_money" && (
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 space-y-2 mt-2">
                      <p className="text-[10px] text-amber-800 font-bold leading-relaxed">
                        Pour valider votre règlement Orange Money, suivez les instructions sur votre mobile.
                      </p>
                    </div>
                  )}

                  {method === "wave" && (
                    <div className="bg-sky-50 rounded-xl p-3 border border-sky-100 text-[10px] text-sky-800 font-bold leading-relaxed">
                      Une notification de transaction Wave vous sera envoyée directement sur votre application pour approuver le paiement de {totalPrice.toLocaleString("fr-FR")} XOF d'un seul clic.
                    </div>
                  )}
                  
                  {method === "mtn_momo" && (
                    <div className="bg-amber-50/50 rounded-xl p-3 border border-amber-100/50 text-[10px] text-amber-800 font-bold leading-relaxed">
                      Tapez *133# sur votre clavier si l'invite de dialogue MTN MoMo d'approbation d'un montant de {totalPrice.toLocaleString("fr-FR")} F n'apparait pas automatiquement sur l'écran de votre smartphone.
                    </div>
                  )}
                </div>
              ) : (
                /* Bank Credit Card payments input style */
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-700">Nom sur la Carte</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex : Jean-Eudes Koffi"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-700">Numéro de Carte de Crédit</label>
                    <div className="relative">
                      <CreditCard className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        required
                        placeholder="4000 1234 5678 9010"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">Date d'expiration</label>
                      <input
                        type="text"
                        required
                        placeholder="MM/AA"
                        maxLength={5}
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 text-center font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">Code CVV</label>
                      <input
                        type="text"
                        required
                        maxLength={3}
                        placeholder="123"
                        value={cvv}
                        onChange={(e) => setCvv(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 py-3 px-4 text-xs outline-none focus:border-orange-500 focus:ring-1 text-center font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Affichage de l'ID marchand Paiement Pro configure */}
              <div className="p-3 bg-orange-50/20 border border-orange-150/20 rounded-2xl space-y-1">
                <div className="flex items-center justify-between text-[10px] text-gray-500 font-semibold">
                  <span>Passerelle Actrice :</span>
                  <span className="text-orange-600 font-extrabold uppercase">Paiement Pro (CI)</span>
                </div>
              </div>

              {/* Action buttons triggers */}
              <div className="pt-6 border-t border-gray-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("configure")}
                  className="rounded-xl px-4 py-3 text-xs font-bold text-gray-500 hover:text-gray-700"
                >
                  Retour
                </button>
                <button
                  type="submit"
                  id="final-pay-submit-btn"
                  className="rounded-xl bg-orange-600 px-6 py-3.5 text-xs font-black text-white hover:bg-orange-700 transition shadow-md shadow-orange-100 flex items-center space-x-1.5 active:scale-95"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>Payer {totalPrice.toLocaleString("fr-FR")} XOF</span>
                </button>
              </div>
            </form>
          )}

          {step === "processing" && (
            <div className="py-12 flex flex-col items-center text-center space-y-4" id="checkout-processing-view">
              <div className="relative">
                <div className="h-16 w-16 animate-spin rounded-full border-4 border-dashed border-orange-200 border-t-orange-600" />
                <Smartphone className="absolute top-1/2 left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-orange-500 animate-pulse" />
              </div>
              <div>
                <h4 className="text-sm font-black text-gray-900">Communication avec l'opérateur en cours...</h4>
                <p className="text-[11px] text-gray-400 mt-1 font-semibold">Vérification de la transaction réglementée via Wave, OM ou MTN.</p>
              </div>
              <div className="inline-flex items-center space-x-1 border border-orange-50 bg-orange-50/20 rounded-md px-2.5 py-1 text-[9px] text-orange-700 font-extrabold uppercase tracking-wide">
                <span>Protocole SSL 256 bits</span>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="py-10 flex flex-col items-center text-center space-y-5" id="checkout-success-view">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-500 border border-green-150 shadow-md">
                <Check className="h-7 w-7" strokeWidth={3} />
              </div>
              <div>
                <h4 className="text-base font-black text-gray-900">Commande Initiale Validée !</h4>
                {isGuest ? (
                  <p className="text-xs text-gray-500 mt-1 pb-1">
                    Vos billets (avec QR codes) seront envoyés à <strong className="text-orange-600">{buyerEmail}</strong> après confirmation du paiement.
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 mt-1 pb-1">Vos billets ont été configurés avec succès dans votre espace.</p>
                )}
              </div>

              {paymentUrl ? (
                <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl w-full space-y-3">
                  <p className="text-xs text-orange-850 font-semibold leading-relaxed">
                    Une passerelle sécurisée <strong className="text-orange-600">Paiement Pro (CI)</strong> a été initiée pour effectuer le transfert. Si la page ne s'est pas ouverte automatiquement, cliquez ci-dessous :
                  </p>
                  <a
                    href={paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full justify-center items-center rounded-xl bg-orange-600 px-4 py-3 text-xs font-black text-white hover:bg-orange-700 transition shadow-md shadow-orange-100"
                    id="paiement-pro-direct-link"
                  >
                    Ouvrir le guichet Paiement Pro
                  </a>
                </div>
              ) : (
                <div className="p-4 bg-gray-50 border border-gray-150 rounded-2xl w-full text-xs text-gray-500">
                  Transaction simulée terminée avec succès.
                </div>
              )}

              <div className="text-[10px] text-gray-450 font-medium tracking-wide">
                Passerelle : <strong className="text-gray-600">Paiement Pro (CI)</strong>
              </div>

              <button
                onClick={onClose}
                className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 text-xs font-extrabold transition font-sans w-full"
              >
                Accéder à mes Billets
              </button>
            </div>
          )}
        </div>
    </ResponsiveSheet>
  );
}
