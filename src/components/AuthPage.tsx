import React, { useState } from "react";
import { Mail, Lock, User as UserIcon, LogIn, ArrowRight, ArrowLeft, KeyRound, CheckCircle2, Ticket } from "lucide-react";
import { User, UserRole } from "../types";

type AuthMode = "login" | "register" | "forgot" | "reset";

interface AuthPageProps {
  onSuccess: (user: User) => void;
  onCancel: () => void;
  /** Présent quand l'utilisateur arrive depuis le lien de réinitialisation reçu par e-mail. */
  initialResetToken?: string | null;
}

export default function AuthPage({ onSuccess, onCancel, initialResetToken }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>(initialResetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("client");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "reset" && password !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);

    const endpoint =
      mode === "login" ? "/api/auth/login"
      : mode === "register" ? "/api/auth/register"
      : mode === "forgot" ? "/api/auth/forgot-password"
      : "/api/auth/reset-password";

    const payload =
      mode === "login" ? { email, password }
      : mode === "register" ? { email, password, name, role }
      : mode === "forgot" ? { email }
      : { token: initialResetToken, newPassword: password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Une erreur est survenue lors de l'authentification.");
      }

      if (mode === "forgot") {
        setForgotPasswordSent(true);
        return;
      }

      // login / register / reset renvoient tous un objet utilisateur + session
      onSuccess(data);
    } catch (err: any) {
      setError(err.message || "Impossible de se connecter au serveur.");
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setError(null);
    setForgotPasswordSent(false);
    setPassword("");
    setConfirmPassword("");
  }

  const titles: Record<AuthMode, string> = {
    login: "Ravi de vous revoir !",
    register: "Créer votre compte clicbillet",
    forgot: "Mot de passe oublié",
    reset: "Choisir un nouveau mot de passe"
  };

  const subtitles: Record<AuthMode, string> = {
    login: "Accédez à vos billets et statistiques en un instant",
    register: "Rejoignez la billetterie la plus innovante de Côte d'Ivoire",
    forgot: "Indiquez votre e-mail, nous vous enverrons un lien de réinitialisation",
    reset: "Choisissez un mot de passe sécurisé pour votre compte"
  };

  return (
    <div className="mx-auto max-w-md py-12" id="auth-page-container">
      <div className="rounded-2xl border border-orange-50 bg-white p-6 shadow-xl sm:p-8">

        {/* Brand visual header inside card */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-600 font-bold text-white shadow-lg shadow-orange-100">
            {mode === "forgot" || mode === "reset" ? <KeyRound className="h-7 w-7" /> : <Ticket className="h-7 w-7 rotate-12" />}
          </div>
          <h2 className="mt-4 text-xl font-black text-gray-900">{titles[mode]}</h2>
          <p className="mt-1.5 text-xs text-gray-500">{subtitles[mode]}</p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg bg-red-50 p-3.5 text-xs font-semibold text-red-600 border border-red-100" id="auth-error-alert">
            {error}
          </div>
        )}

        {mode === "forgot" && forgotPasswordSent ? (
          <div className="space-y-5 text-center" id="forgot-password-sent-view">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-gray-700">
              Si un compte existe avec cette adresse e-mail, un lien de réinitialisation vient de lui être envoyé.
            </p>
            <p className="text-xs text-gray-400">
              Vérifiez votre boîte de réception (et vos spams). Le lien est valable 1 heure.
            </p>
            <button
              id="back-to-login-btn"
              onClick={() => switchMode("login")}
              className="inline-flex items-center space-x-1 text-xs font-bold text-orange-600 hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Retour à la connexion</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Complete Name field - only active on registration */}
            {mode === "register" && (
              <div id="auth-name-field" className="space-y-1">
                <label className="text-xs font-bold text-gray-700">Nom Complet ou Nom d'Organisation</label>
                <div className="relative">
                  <UserIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    required
                    placeholder="Ex: Jean-Eudes Koffi ou Overcom Production"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                  />
                </div>
              </div>
            )}

            {/* Email Address field - login / register / forgot */}
            {mode !== "reset" && (
              <div className="space-y-1" id="auth-email-field">
                <label className="text-xs font-bold text-gray-700">Adresse E-mail</label>
                <div className="relative">
                  <Mail className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    required
                    placeholder="Ex: nom@domaine.ci"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                  />
                </div>
              </div>
            )}

            {/* Password field - login / register / reset */}
            {mode !== "forgot" && (
              <div className="space-y-1" id="auth-password-field">
                <label className="text-xs font-bold text-gray-700 font-sans">
                  {mode === "reset" ? "Nouveau mot de passe" : "Mot de passe"}
                </label>
                <div className="relative">
                  <Lock className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    required
                    minLength={mode === "reset" ? 6 : undefined}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                  />
                </div>
              </div>
            )}

            {/* Confirm new password - reset only */}
            {mode === "reset" && (
              <div className="space-y-1" id="auth-confirm-password-field">
                <label className="text-xs font-bold text-gray-700 font-sans">Confirmer le mot de passe</label>
                <div className="relative">
                  <Lock className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                  />
                </div>
              </div>
            )}

            {/* "Mot de passe oublié ?" link - login only */}
            {mode === "login" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  id="forgot-password-link"
                  onClick={() => switchMode("forgot")}
                  className="text-[11px] font-bold text-orange-600 hover:underline"
                >
                  Mot de passe oublié ?
                </button>
              </div>
            )}

            {/* Role selector - only active on registration */}
            {mode === "register" && (
              <div className="space-y-2 pt-1" id="auth-role-selector">
                <label className="text-xs font-bold text-gray-700">Type de Compte</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    id="role-btn-client"
                    onClick={() => setRole("client")}
                    className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all active:scale-95 ${
                      role === "client"
                        ? "border-orange-500 bg-orange-50/50 text-orange-600 ring-1 ring-orange-500"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Ticket className="mb-1 h-5 w-5" />
                    <span className="text-xs font-black">Acheteur</span>
                    <span className="text-[10px] text-gray-500 font-semibold mt-0.5">Acheter des billets</span>
                  </button>

                  <button
                    type="button"
                    id="role-btn-organizer"
                    onClick={() => setRole("organizer")}
                    className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all active:scale-95 ${
                      role === "organizer"
                        ? "border-orange-500 bg-orange-50/50 text-orange-600 ring-1 ring-orange-500"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <UserIcon className="mb-1 h-5 w-5" />
                    <span className="text-xs font-black">Organisateur</span>
                    <span className="text-[10px] text-gray-500 font-semibold mt-0.5">Créer et vendre</span>
                  </button>
                </div>
              </div>
            )}

            {/* Submit Action Button */}
            <button
              type="submit"
              id="auth-submit-btn"
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center space-x-2 rounded-xl bg-orange-600 py-3.5 text-xs font-extrabold text-white shadow-md shadow-orange-100 transition-all hover:bg-orange-700 disabled:bg-gray-300"
            >
              {loading ? (
                <span className="animate-pulse">Veuillez patienter...</span>
              ) : mode === "login" ? (
                <>
                  <span>Se connecter</span>
                  <LogIn className="h-4 w-4" />
                </>
              ) : mode === "register" ? (
                <>
                  <span>S'inscrire avec e-mail</span>
                  <LogIn className="h-4 w-4" />
                </>
              ) : mode === "forgot" ? (
                <>
                  <span>Envoyer le lien de réinitialisation</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              ) : (
                <>
                  <span>Réinitialiser mon mot de passe</span>
                  <KeyRound className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Toggle between Login / Sign Up / Forgot */}
        {!forgotPasswordSent && (
          <div className="mt-6 border-t border-gray-100 pt-5 text-center space-y-4">
            {mode === "forgot" ? (
              <button
                id="back-to-login-btn"
                onClick={() => switchMode("login")}
                className="inline-flex items-center space-x-1 text-xs font-bold text-orange-600 hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Retour à la connexion</span>
              </button>
            ) : mode === "reset" ? null : (
              <button
                id="toggle-auth-mode-btn"
                onClick={() => switchMode(mode === "login" ? "register" : "login")}
                className="inline-flex items-center space-x-1 text-xs font-bold text-orange-600 hover:underline"
              >
                <span>{mode === "login" ? "Nouveau sur ClicBillet ? Créer un compte" : "Déjà membre ? Se connecter"}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}

            {mode === "login" && (
              <div className="rounded-xl bg-orange-50/70 p-3 text-center text-xs text-orange-800 border border-orange-100 space-y-1">
                <span className="font-black">💡 Mode démo :</span>
                <div className="font-mono text-[10px] bg-white rounded-md p-1 border border-orange-100">
                  Créez un compte ou utilisez les identifiants fournis par l'administrateur de la plateforme.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cancel actions */}
        <button
          onClick={onCancel}
          id="auth-cancel-btn"
          className="mt-4 w-full text-center text-xs font-bold text-gray-400 hover:text-gray-600"
        >
          Retourner à l'accueil
        </button>
      </div>
    </div>
  );
}
