import { useState } from "react";
import { X, Smartphone, CreditCard, Sparkles } from "lucide-react";
import ResponsiveSheet from "./ResponsiveSheet";
import { PaiementProButton, PaiementProConfig } from "./PaiementProButton";
import { VotingCampaign, Candidate, User, PaymentMethod } from "../types";

interface VotePremiumSheetProps {
  campaign: VotingCampaign;
  candidate: Candidate;
  user: User | null;
  onClose: () => void;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  orange_money: "Orange Money",
  mtn_momo: "MTN Mobile Money",
  moov_money: "Moov Money",
  wave: "Wave",
  card: "Carte bancaire"
};

const CHANNEL_MAPPING: Record<PaymentMethod, string> = {
  orange_money: "OMCIV2",
  mtn_momo: "MOMOCI",
  moov_money: "FLOOZ",
  wave: "WAVECI",
  card: "CARD"
};

export default function VotePremiumSheet({ campaign, candidate, user, onClose }: VotePremiumSheetProps) {
  const [selectedPack, setSelectedPack] = useState<{ votes: number; price: number } | null>(campaign.premiumVotePacks[0] || null);
  const [method, setMethod] = useState<PaymentMethod>("orange_money");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [step, setStep] = useState<"configure" | "pay" | "success">("configure");
  const [checkoutData, setCheckoutData] = useState<{ orderId: string; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const buyerEmail = user?.email || guestEmail;
  const isGuest = !user;

  async function handleContinue() {
    setError(null);
    if (!selectedPack) {
      setError("Choisissez un pack de voix.");
      return;
    }
    if (isGuest && (!guestEmail || !guestPhone)) {
      setError("Email et téléphone requis pour acheter des voix sans compte.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/voting/campaigns/${campaign.id}/candidates/${candidate.id}/vote-premium/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            votesQty: selectedPack.votes,
            buyerEmail,
            buyerPhone: isGuest ? guestPhone : undefined,
            paymentDetails: { method }
          })
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erreur lors de la préparation du paiement.");
      setCheckoutData({ orderId: data.orderId, amount: data.amount });
      setStep("pay");
    } catch (e: any) {
      setError(e.message || "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  }

  const paiementProConfig: PaiementProConfig | null = checkoutData
    ? {
        merchantId: (import.meta as any).env?.VITE_PAIEMENT_PRO_MERCHANT_ID || "ID_MARCHAND_DEMO",
        amount: checkoutData.amount,
        channel: CHANNEL_MAPPING[method] as any,
        referenceNumber: checkoutData.orderId,
        customerEmail: buyerEmail || "customer@example.com",
        customerFirstName: "Vote",
        customerLastname: user?.name?.split(" ")[0] || "Électeur",
        customerPhoneNumber: guestPhone || "0700000000",
        description: `${selectedPack?.votes} voix pour ${candidate.name} - ${campaign.title}`,
        notificationURL: `${window.location.origin}/api/payment/callback`,
        returnURL: `${window.location.origin}/?payment_success=true&order_id=${checkoutData.orderId}`
      }
    : null;

  return (
    <ResponsiveSheet id="vote-premium-sheet" onClose={onClose} panelClassName="max-w-md max-h-[90vh] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-orange-600" />
          <h3 className="text-sm font-black text-gray-950">Voter pour {candidate.name}</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100" id="vote-premium-close">
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      <div className="p-5 space-y-4 overflow-y-auto">
        {step === "configure" && (
          <>
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase mb-2">Choisir un pack de voix</p>
              <div className="grid grid-cols-2 gap-2">
                {campaign.premiumVotePacks.map((pack) => (
                  <button
                    key={pack.votes}
                    onClick={() => setSelectedPack(pack)}
                    className={`rounded-2xl border p-3 text-left transition ${
                      selectedPack?.votes === pack.votes
                        ? "border-orange-600 bg-orange-50"
                        : "border-gray-200 hover:border-orange-300"
                    }`}
                  >
                    <span className="block text-sm font-black text-gray-950">{pack.votes} voix</span>
                    <span className="block text-[11px] font-bold text-orange-650">{pack.price.toLocaleString("fr-FR")} XOF</span>
                  </button>
                ))}
              </div>
            </div>

            {isGuest && (
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder="Votre email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 py-2.5 px-3.5 text-xs outline-none focus:border-orange-500"
                />
                <input
                  type="tel"
                  placeholder="Votre numéro de téléphone"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 py-2.5 px-3.5 text-xs outline-none focus:border-orange-500"
                />
              </div>
            )}

            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase mb-2">Moyen de paiement</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-[11px] font-bold transition ${
                      method === m ? "border-orange-600 bg-orange-50 text-orange-650" : "border-gray-200 text-gray-600 hover:border-orange-300"
                    }`}
                  >
                    {m === "card" ? <CreditCard className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
                    {METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-[11px] font-bold text-red-600">{error}</p>}

            <button
              onClick={handleContinue}
              disabled={submitting}
              className="w-full rounded-2xl bg-orange-600 py-3 text-xs font-black uppercase text-white active:scale-[0.98] transition disabled:opacity-60"
              id="vote-premium-continue"
            >
              {submitting ? "Préparation..." : "Continuer vers le paiement"}
            </button>
          </>
        )}

        {step === "pay" && paiementProConfig && (
          <PaiementProButton
            config={paiementProConfig}
            label="Payer et voter"
            className="bg-orange-600 text-white rounded-2xl py-3 text-xs font-black uppercase"
            onPaymentUrlGenerated={() => setStep("success")}
            onError={(msg) => setError(msg)}
          />
        )}

        {step === "success" && (
          <div className="text-center py-6">
            <p className="text-sm font-black text-gray-950">Guichet de paiement ouvert dans un nouvel onglet.</p>
            <p className="mt-2 text-[11px] text-gray-500">
              Vos voix seront créditées dès la confirmation du paiement.
            </p>
          </div>
        )}
      </div>
    </ResponsiveSheet>
  );
}
