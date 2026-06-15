import React, { useState } from "react";
import { X, Check, ArrowRight, ShieldCheck, CreditCard, MessageSquare, Ticket, Sparkles, Smartphone } from "lucide-react";
import { Event, User, PaymentMethod, PaymentDetails } from "../types";

interface CheckoutModalProps {
  event: Event;
  user: User | null;
  onClose: () => void;
  onSuccess: (ticket: any) => void;
  onOpenAuth: () => void;
}

export default function CheckoutModal({ event, user, onClose, onSuccess, onOpenAuth }: CheckoutModalProps) {
  const [step, setStep] = useState<"configure" | "details" | "processing" | "success">("configure");
  const [tier, setTier] = useState<"standard" | "vip">("standard");
  const [quantity, setQuantity] = useState(1);
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
  const basePrice = event.price;
  const unitPrice = tier === "vip" ? basePrice + 10000 : basePrice;
  const totalPrice = unitPrice * quantity;

  // Gateways configurations with logo text & primary CSS theme styles
  const GATEWAYS = [
    { id: "orange_money" as PaymentMethod, name: "Orange Money", desc: "Mobile Money", color: "border-orange-500 hover:bg-orange-50/20 text-orange-600 bg-orange-500/5" },
    { id: "mtn_momo" as PaymentMethod, name: "MTN MoMo", desc: "MoMo Pay", color: "border-amber-400 hover:bg-amber-50/20 text-amber-600 bg-amber-400/5" },
    { id: "moov_money" as PaymentMethod, name: "Moov Money", desc: "Flooz Pay", color: "border-teal-500 hover:bg-teal-50/20 text-teal-600 bg-teal-500/5" },
    { id: "wave" as PaymentMethod, name: "Wave Money", desc: "Wave App", color: "border-sky-500 hover:bg-sky-50/20 text-sky-600 bg-sky-500/5" },
    { id: "card" as PaymentMethod, name: "Carte Bancaire", desc: "Visa / Mastercard", color: "border-black hover:bg-gray-50 text-gray-900 bg-gray-500/5" },
  ];

  function handleGoToDetails() {
    if (!user) {
      // Prompt Auth first if anonymous
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
      if (method === "orange_money" && otp.length < 4) {
        setError("Veuillez saisir votre code d'autorisation Orange Money (#144*46#).");
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

    // Initiate backend express purchase sequence
    const paymentDetails: PaymentDetails = {
      method,
      phoneNumber,
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
        buyerId: user?.id,
        buyerName: user?.name,
        buyerEmail: user?.email,
        tier,
        quantity,
        paymentDetails
      };

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Une erreur est survenue lors de la validation du paiement.");
      }

      // INTEGRATION PAIEMENT PRO (CÔTE D'IVOIRE)
      try {
        const merchantId = (import.meta as any).env.VITE_PAIEMENT_PRO_MERCHANT_ID || "ID_MARCHAND_DEMO";
        const LibPaiementPro = (window as any).PaiementPro;
        
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
          
          // Référence unique de notre plateforme
          pPro.referenceNumber = data.ticket.id || `TX-${Date.now()}`;
          pPro.customerEmail = user?.email || "customer@example.com";
          
          // Séparation prénom / nom pour respecter les obligations du SDK
          const fullName = user?.name || "Client ClicBillet";
          const nameParts = fullName.trim().split(/\s+/);
          pPro.customerLastname = nameParts[0] || "Client";
          pPro.customerFirstName = nameParts.slice(1).join(" ") || "Billet";
          
          pPro.customerPhoneNumber = phoneNumber || "0700000000";
          pPro.description = `Billet ${tier.toUpperCase()} - ${event.title}`;
          
          const appUrl = window.location.origin;
          pPro.notificationURL = `${appUrl}/api/payment/callback`;
          pPro.returnURL = `${appUrl}/?payment_success=true&ticket_id=${data.ticket.id}`;
          pPro.returnContext = JSON.stringify({ ticketId: data.ticket.id, userId: user?.id });
          
          await pPro.getUrlPayment();
          
          if (pPro.success && pPro.url) {
            console.log("[PaiementPro] Lien de paiement généré :", pPro.url);
            setPaymentUrl(pPro.url);
            
            // Ouvrir la passerelle de paiement dans une nouvelle fenêtre/onglet
            window.open(pPro.url, "_blank");
          } else {
            console.warn("[PaiementPro] Succès de l'initialisation non retourné par l'API, mode simulation actif.");
          }
        } else {
          console.warn("[PaiementPro SDK] SDK non chargé globalement dans l'index.html, utilisation de la simulation locale.");
        }
      } catch (sdkErr) {
        console.error("[PaiementPro SDK Integration Error]", sdkErr);
      }

      // Checkout Success! Go to step 4
      setStep("success");
      onSuccess(data.ticket);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erreur de connexion.");
      setStep("details");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs" id="checkout-modal-overlay">
      <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden border border-gray-100 flex flex-col" id="checkout-modal-panel">
        
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
              {/* Select Seat Tier */}
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-700 block">Choisissez la Catégorie du Ticket</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setTier("standard")}
                    className={`flex flex-col p-4 rounded-xl border text-left transition-all ${
                      tier === "standard"
                        ? "border-orange-500 bg-orange-50/15 ring-1 ring-orange-550"
                        : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <span className="text-xs font-black text-gray-900">Pass Standard</span>
                    <span className="text-[10px] text-gray-400 font-semibold mt-0.5">Accès général à l'événement</span>
                    <span className="text-sm font-black text-orange-600 mt-3">{basePrice.toLocaleString("fr-FR")} F XOF</span>
                  </button>

                  <button
                    onClick={() => setTier("vip")}
                    className={`flex flex-col p-4 rounded-xl border text-left transition-all relative overflow-hidden ${
                      tier === "vip"
                        ? "border-amber-500 bg-amber-50/15 ring-1 ring-amber-550"
                        : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="absolute top-0 right-0 rounded-bl-lg bg-amber-500 text-[8px] px-1.5 py-0.5 font-bold uppercase text-white tracking-widest">
                      VIP
                    </div>
                    <span className="text-xs font-black text-gray-900 flex items-center space-x-1">
                      <Sparkles className="h-3 w-3 text-amber-500" />
                      <span>Pass VIP</span>
                    </span>
                    <span className="text-[10px] text-gray-400 font-semibold mt-0.5">Accès Premium aux premiers rangs</span>
                    <span className="text-sm font-black text-amber-600 mt-3">{(basePrice + 10000).toLocaleString("fr-FR")} F XOF</span>
                  </button>
                </div>
              </div>

              {/* Quantity Selector input logic */}
              <div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl border border-gray-100">
                <div>
                  <label className="text-xs font-black text-gray-950 block">Nombre de places</label>
                  <p className="text-[10px] text-gray-400 font-medium mt-0.5">Maximum de 10 tickets par achat</p>
                </div>
                <div className="flex items-center space-x-3.5">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 font-bold hover:bg-gray-100 transition active:scale-95"
                  >
                    -
                  </button>
                  <span className="text-base font-extrabold text-gray-950 font-sans">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.min(10, quantity + 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-600 font-bold hover:bg-gray-100 transition active:scale-95"
                  >
                    +
                  </button>
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
              <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100/30 flex items-center justify-between text-xs mb-3">
                <span className="text-gray-500 font-semibold uppercase font-mono">Billet: {tier === "vip" ? "VIP" : "Standard"} ({quantity} pos)</span>
                <span className="text-sm font-extrabold text-orange-650">{totalPrice.toLocaleString("fr-FR")} XOF</span>
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

                  {/* Orange Money OTP specific instruction */}
                  {method === "orange_money" && (
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 space-y-2 mt-2">
                      <p className="text-[10px] text-amber-800 font-bold leading-relaxed">
                        Pour valider votre règlement Orange Money, veuillez composer le <strong className="text-orange-600">#144*46#</strong> sur votre mobile pour générer un code d'autorisation OTP temporaire.
                      </p>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-amber-900 uppercase">Code d'autorisation OTP</label>
                        <input
                          type="text"
                          required
                          maxLength={6}
                          placeholder="Ex : 4521"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          className="w-full rounded-lg border border-amber-200 bg-white py-2 px-3 text-xs outline-none focus:border-amber-500 placeholder:text-gray-300 font-mono text-center font-bold tracking-widest"
                        />
                      </div>
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
                <p className="text-xs text-gray-500 mt-1 pb-1">Votre billet a été configuré avec succès dans votre espace.</p>
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

              <button
                onClick={onClose}
                className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 text-xs font-extrabold transition font-sans w-full"
              >
                Accéder à mes Billets
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
