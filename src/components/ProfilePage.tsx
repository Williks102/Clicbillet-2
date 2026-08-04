import { useState, useEffect } from "react";
import { KeyRound, LogOut, FileText, ShieldCheck, ChevronRight, Ticket, LayoutDashboard, CheckCircle2, ShieldAlert, Smartphone } from "lucide-react";
import { User } from "../types";
import { authFetch } from "../lib/apiClient";
import AccountCodeBadge from "./AccountCodeBadge";
import BecomeOrganizerCard from "./BecomeOrganizerCard";

interface ProfilePageProps {
  user: User;
  onLogout: () => void;
  setActiveTab: (tab: string) => void;
}

const roleLabel: Record<User["role"], string> = {
  admin: "Admin",
  organizer: "Organisateur",
  client: "Client",
};

interface MfaStatus {
  available: boolean;
  enabled: boolean;
  factorId: string | null;
}

interface MfaEnrollData {
  factorId: string;
  qrCode: string;
  secret: string;
}

export default function ProfilePage({ user, onLogout, setActiveTab }: ProfilePageProps) {
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // Double authentification (TOTP), réservée aux organisateurs/admins (comptes qui gèrent
  // l'argent — cf. server/routes/auth.ts pour la vérification côté serveur, jamais fiée à
  // l'affichage seul).
  const mfaEligible = user.role === "organizer" || user.role === "admin";
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaEnrollData, setMfaEnrollData] = useState<MfaEnrollData | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  useEffect(() => {
    if (!mfaEligible) return;
    (async () => {
      try {
        const res = await authFetch("/api/auth/mfa/status", { method: "GET" });
        if (res.ok) setMfaStatus(await res.json());
      } catch {
        // Statut indisponible : la section reste simplement masquée/inactive.
      }
    })();
  }, [mfaEligible]);

  async function handleStartMfaEnroll() {
    setMfaError(null);
    setMfaLoading(true);
    try {
      const res = await authFetch("/api/auth/mfa/enroll", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Impossible d'activer la double authentification.");
      setMfaEnrollData(data);
    } catch (err: any) {
      setMfaError(err.message || "Erreur réseau.");
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleConfirmMfaEnroll() {
    if (!mfaEnrollData) return;
    setMfaError(null);
    setMfaLoading(true);
    try {
      const res = await authFetch("/api/auth/mfa/enroll/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId: mfaEnrollData.factorId, code: mfaCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Code invalide.");
      setMfaStatus({ available: true, enabled: true, factorId: mfaEnrollData.factorId });
      setMfaEnrollData(null);
      setMfaCode("");
    } catch (err: any) {
      setMfaError(err.message || "Erreur réseau.");
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleDisableMfa() {
    if (!mfaStatus?.factorId) return;
    setMfaError(null);
    setMfaLoading(true);
    try {
      const res = await authFetch("/api/auth/mfa/unenroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId: mfaStatus.factorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Impossible de désactiver la double authentification.");
      setMfaStatus({ available: true, enabled: false, factorId: null });
    } catch (err: any) {
      setMfaError(err.message || "Erreur réseau.");
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleResetPassword() {
    setResetLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "ClicBillet" },
        body: JSON.stringify({ email: user.email }),
      });
      setResetSent(true);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="flex flex-col items-center py-4 text-center">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-xl font-extrabold text-white shadow-md shadow-orange-200">
          {user.name.slice(0, 1).toUpperCase()}
        </div>
        <h1 className="text-lg font-extrabold text-gray-900">{user.name}</h1>
        <p className="text-sm text-gray-500">{user.email}</p>
        <span className={`mt-2 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
          user.role === "admin" ? "bg-purple-100 text-purple-800"
          : user.role === "organizer" ? "bg-orange-100 text-orange-800"
          : "bg-blue-100 text-blue-800"
        }`}>
          {roleLabel[user.role]}
        </span>
        <AccountCodeBadge code={user.publicCode} className="mt-3" />
        {user.publicCode && (
          <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-gray-400">
            Communiquez ce code au support ClicBillet pour être identifié immédiatement.
          </p>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {/* "Mes billets" reste accessible aux organisateurs : un organisateur peut acheter des
            billets comme n'importe qui, et sa promotion depuis un compte acheteur (cf. demande
            ci-dessous) conserve tout son historique d'achats. */}
        {user.role !== "admin" && (
          <button
            onClick={() => setActiveTab("client-dashboard")}
            className="flex w-full items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3.5 text-sm font-bold text-gray-800 shadow-xs transition-colors hover:bg-gray-50"
          >
            <span className="flex items-center gap-2.5"><Ticket className="h-4.5 w-4.5 text-orange-600" />Mes billets</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
        )}

        {user.role === "organizer" && (
          <button
            onClick={() => setActiveTab("organizer-dashboard")}
            className="flex w-full items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3.5 text-sm font-bold text-gray-800 shadow-xs transition-colors hover:bg-gray-50"
          >
            <span className="flex items-center gap-2.5"><LayoutDashboard className="h-4.5 w-4.5 text-orange-600" />Tableau de bord</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
        )}

        {user.role === "client" && <BecomeOrganizerCard />}

        <div className="rounded-2xl border border-gray-100 bg-white shadow-xs">
          <button
            onClick={handleResetPassword}
            disabled={resetLoading || resetSent}
            className="flex w-full items-center justify-between px-4 py-3.5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            <span className="flex items-center gap-2.5">
              <KeyRound className="h-4.5 w-4.5 text-orange-600" />
              {resetSent ? "E-mail de réinitialisation envoyé" : "Réinitialiser mon mot de passe"}
            </span>
            {resetSent ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <ChevronRight className="h-4 w-4 text-gray-300" />}
          </button>
        </div>

        {mfaEligible && mfaStatus?.available && (
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-xs" id="mfa-settings-section">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5 text-sm font-bold text-gray-800">
                <Smartphone className="h-4.5 w-4.5 text-orange-600" />
                Double authentification
              </span>
              {mfaStatus.enabled && (
                <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-[10px] font-black uppercase text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> Activée
                </span>
              )}
            </div>

            {mfaError && (
              <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-600" id="mfa-error-alert">{mfaError}</p>
            )}

            {mfaEnrollData ? (
              <div className="mt-3 space-y-3" id="mfa-enroll-view">
                <p className="text-xs text-gray-500">
                  Scannez ce QR code avec votre application d'authentification (Google Authenticator, Authy...), ou saisissez le code manuellement.
                </p>
                <div className="flex justify-center rounded-xl border border-gray-100 bg-gray-50 p-3" dangerouslySetInnerHTML={{ __html: mfaEnrollData.qrCode }} />
                <div className="rounded-lg bg-gray-50 p-2 text-center font-mono text-xs tracking-wider text-gray-600 select-all">
                  {mfaEnrollData.secret}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Code à 6 chiffres"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-xl border border-gray-200 py-2.5 px-4 text-center font-mono tracking-[0.4em] text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmMfaEnroll}
                    disabled={mfaLoading || mfaCode.length !== 6}
                    className="flex-1 rounded-xl bg-orange-600 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-orange-700 disabled:bg-gray-300"
                  >
                    {mfaLoading ? "Vérification..." : "Confirmer"}
                  </button>
                  <button
                    onClick={() => { setMfaEnrollData(null); setMfaCode(""); setMfaError(null); }}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : mfaStatus.enabled ? (
              <button
                onClick={handleDisableMfa}
                disabled={mfaLoading}
                className="mt-3 w-full rounded-xl border border-red-100 py-2.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
              >
                {mfaLoading ? "Désactivation..." : "Désactiver la double authentification"}
              </button>
            ) : (
              <>
                <p className="mt-1.5 text-xs text-gray-500">
                  Protégez votre compte avec un code à usage unique généré par une application d'authentification, en plus de votre mot de passe.
                </p>
                <button
                  onClick={handleStartMfaEnroll}
                  disabled={mfaLoading}
                  className="mt-3 w-full rounded-xl bg-orange-600 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-orange-700 disabled:bg-gray-300"
                >
                  {mfaLoading ? "Chargement..." : "Activer la double authentification"}
                </button>
              </>
            )}
          </div>
        )}

        {mfaEligible && mfaStatus && !mfaStatus.available && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-semibold text-amber-700">
            <ShieldAlert className="h-4.5 w-4.5 shrink-0" />
            La double authentification nécessite une configuration Supabase active.
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xs">
          <button
            onClick={() => setActiveTab("terms")}
            className="flex w-full items-center justify-between border-b border-gray-50 px-4 py-3.5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50"
          >
            <span className="flex items-center gap-2.5"><FileText className="h-4.5 w-4.5 text-orange-600" />Conditions Générales de Vente</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          <button
            onClick={() => setActiveTab("privacy")}
            className="flex w-full items-center justify-between px-4 py-3.5 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50"
          >
            <span className="flex items-center gap-2.5"><ShieldCheck className="h-4.5 w-4.5 text-orange-600" />Politique de confidentialité</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
        </div>

        <button
          onClick={onLogout}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-50 px-4 py-3.5 text-sm font-bold text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-4 w-4" />
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
