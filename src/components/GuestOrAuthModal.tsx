import React, { useState } from "react";
import { X, Mail, Phone, ArrowRight, LogIn, UserPlus, UserCheck } from "lucide-react";
import ResponsiveSheet from "./ResponsiveSheet";

export interface GuestInfo {
  email: string;
  phone: string;
}

interface GuestOrAuthModalProps {
  onGuestContinue: (info: GuestInfo) => void;
  onOpenAuth: () => void;
  onClose: () => void;
}

export default function GuestOrAuthModal({ onGuestContinue, onOpenAuth, onClose }: GuestOrAuthModalProps) {
  const [step, setStep] = useState<"choice" | "guest-form">("choice");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleGuestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError("Veuillez saisir une adresse e-mail valide.");
      return;
    }
    const cleaned = phone.replace(/\s+/g, "");
    if (cleaned.length < 8) {
      setError("Veuillez saisir un numéro de téléphone valide (min. 8 chiffres).");
      return;
    }
    onGuestContinue({ email, phone: cleaned });
  }

  return (
    <ResponsiveSheet
      id="guest-or-auth-modal-overlay"
      panelId="guest-or-auth-modal-panel"
      onClose={onClose}
      panelClassName="max-w-sm overflow-hidden border border-gray-100"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-50 bg-gray-50/50 px-6 py-4">
        <h3 className="text-sm font-black text-gray-900">
          {step === "choice" ? "Comment souhaitez-vous continuer ?" : "Vos coordonnées"}
        </h3>
        <button
          onClick={onClose}
          className="rounded-full bg-white p-1 border border-gray-100 text-gray-400 hover:text-gray-600 shadow-xs active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-6">
        {step === "choice" ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-medium mb-5">
              Créez un compte pour accéder à vos billets à tout moment, ou continuez en tant qu'invité — vos billets seront envoyés par e-mail.
            </p>

            {/* Se connecter */}
            <button
              onClick={onOpenAuth}
              className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-orange-400 hover:bg-orange-50/20 transition-all active:scale-[0.99] group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white">
                  <LogIn className="h-4 w-4" />
                </div>
                <div>
                  <span className="block text-xs font-black text-gray-900">Se connecter / S'inscrire</span>
                  <span className="block text-[10px] text-gray-500 font-semibold mt-0.5">Accédez à vos billets à tout moment</span>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-orange-500 transition" />
            </button>

            {/* Continuer en invité */}
            <button
              onClick={() => setStep("guest-form")}
              className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-gray-400 hover:bg-gray-50 transition-all active:scale-[0.99] group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                  <UserCheck className="h-4 w-4" />
                </div>
                <div>
                  <span className="block text-xs font-black text-gray-900">Continuer sans compte</span>
                  <span className="block text-[10px] text-gray-500 font-semibold mt-0.5">Billets envoyés par e-mail après paiement</span>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleGuestSubmit} className="space-y-4">
            <p className="text-xs text-gray-500 font-medium">
              Vos billets (avec QR codes) seront envoyés à cette adresse après confirmation du paiement.
            </p>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-600 border border-red-100">
                {error}
              </div>
            )}

            {/* Email */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Adresse e-mail *</label>
              <div className="relative">
                <Mail className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  required
                  autoFocus
                  placeholder="nom@exemple.ci"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* Téléphone */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Numéro de téléphone *</label>
              <div className="relative">
                <span className="absolute top-1/2 left-3 text-xs font-extrabold text-gray-500 -translate-y-1/2">+225</span>
                <input
                  type="tel"
                  required
                  placeholder="07 00 00 00 00"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-14 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                />
              </div>
              <span className="text-[10px] text-gray-400 font-semibold">Utilisé pour le paiement Mobile Money si nécessaire.</span>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setStep("choice"); setError(null); }}
                className="flex-1 rounded-xl border border-gray-200 py-3 text-xs font-bold text-gray-500 hover:bg-gray-50 transition"
              >
                Retour
              </button>
              <button
                type="submit"
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-orange-600 py-3 text-xs font-black text-white hover:bg-orange-700 transition shadow-md shadow-orange-100 active:scale-95"
              >
                <span>Accéder aux billets</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        )}
      </div>
    </ResponsiveSheet>
  );
}
