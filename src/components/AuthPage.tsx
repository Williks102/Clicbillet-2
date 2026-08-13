import React, { useState } from "react";
import { Mail, Lock, User as UserIcon, LogIn, ArrowRight, ArrowLeft, KeyRound, CheckCircle2, Ticket } from "lucide-react";
import { User, UserRole } from "../types";

type AuthMode = "login" | "register" | "forgot" | "reset";

// Doit rester aligné sur MIN_PASSWORD_LENGTH (server/lib/validators.ts), seul juge en dernier
// ressort : cette constante ne sert qu'à annoncer la règle au bon moment.
const MIN_PASSWORD_LENGTH = 10;

interface AuthPageProps {
  onSuccess: (user: User) => void;
  onCancel: () => void;
  /** Présent quand l'utilisateur arrive depuis le lien de réinitialisation reçu par e-mail. */
  initialResetToken?: string | null;
  /**
   * Écran affiché en premier. Par défaut la connexion, qui convient à qui vient s'identifier ;
   * un visiteur arrivé par « Devenir promoteur » n'a en revanche pas encore de compte et doit
   * tomber directement sur l'inscription, sans avoir à repérer le lien qui l'y mène.
   */
  initialMode?: "login" | "register";
  /** Type de compte présélectionné à l'inscription (cf. initialMode). */
  initialRole?: UserRole;
  /**
   * Signale les bascules connexion <-> inscription faites depuis le formulaire lui-même
   * (« Déjà membre ? Se connecter »). Sans cela, l'adresse resterait sur l'écran d'origine
   * pendant qu'on affiche l'autre. Les étapes « mot de passe oublié » et « nouveau mot de
   * passe » ne sont pas remontées : ce sont des sous-étapes de la connexion, pas des écrans
   * à part, et elles n'ont pas d'URL propre.
   */
  onModeChange?: (mode: "login" | "register") => void;
}

export default function AuthPage({ onSuccess, onCancel, initialResetToken, initialMode, initialRole, onModeChange }: AuthPageProps) {
  // Le jeton de réinitialisation prime : il vient d'un lien e-mail, l'intention y est explicite.
  const [mode, setMode] = useState<AuthMode>(initialResetToken ? "reset" : initialMode || "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>(initialRole || "client");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false);
  const [confirmationEmailSentTo, setConfirmationEmailSentTo] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // Double authentification (TOTP) : posée par le serveur quand le compte l'a activée (cf.
  // /api/auth/login qui renvoie mfaRequired:true au lieu d'ouvrir directement la session).
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

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
        headers: { "Content-Type": "application/json", "X-Requested-With": "ClicBillet" },
        credentials: "include",
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

      // Inscription : tant que l'e-mail n'est pas confirmé, le serveur ne renvoie pas de
      // session (cf. server/routes/auth.ts) — on invite l'utilisateur à consulter sa boîte
      // de réception au lieu de le connecter automatiquement.
      if (mode === "register" && data.requiresEmailConfirmation) {
        setConfirmationEmailSentTo(data.email || email);
        return;
      }

      // Connexion : ce compte a activé la double authentification, une session temporaire
      // (5 min) attend la vérification du code — cf. /api/auth/mfa/login-verify.
      if (mode === "login" && data.mfaRequired) {
        setMfaRequired(true);
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

  async function handleResendConfirmation() {
    if (!confirmationEmailSentTo) return;
    setResendState("sending");
    try {
      const response = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "ClicBillet" },
        credentials: "include",
        body: JSON.stringify({ email: confirmationEmailSentTo }),
      });
      // Le serveur répond volontairement la même chose que le compte existe ou non ; seul un
      // refus franc (limite de débit atteinte) mérite d'être signalé ici.
      setResendState(response.ok ? "sent" : "error");
    } catch {
      setResendState("error");
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/mfa/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "ClicBillet" },
        credentials: "include",
        body: JSON.stringify({ code: mfaCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Code de vérification invalide.");
      }
      onSuccess(data);
    } catch (err: any) {
      setError(err.message || "Impossible de vérifier le code.");
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    if (next === "login" || next === "register") onModeChange?.(next);
    setError(null);
    setForgotPasswordSent(false);
    setConfirmationEmailSentTo(null);
    setResendState("idle");
    setMfaRequired(false);
    setMfaCode("");
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

        {mode === "login" && mfaRequired ? (
          <form onSubmit={handleMfaSubmit} className="space-y-5" id="mfa-challenge-view">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-orange-50 text-orange-600">
              <KeyRound className="h-6 w-6" />
            </div>
            <p className="text-center text-sm font-semibold text-gray-700">
              Entrez le code à 6 chiffres généré par votre application d'authentification.
            </p>
            <div className="space-y-1" id="mfa-code-field">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                maxLength={6}
                placeholder="123456"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-xl border border-gray-200 py-3 px-4 text-center text-lg tracking-[0.5em] font-mono outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100"
              />
            </div>
            <button
              type="submit"
              id="mfa-verify-btn"
              disabled={loading || mfaCode.length !== 6}
              className="flex w-full items-center justify-center space-x-2 rounded-xl bg-orange-600 py-3.5 text-xs font-extrabold text-white shadow-md shadow-orange-100 transition-all hover:bg-orange-700 disabled:bg-gray-300"
            >
              {loading ? <span className="animate-pulse">Vérification...</span> : <span>Vérifier</span>}
            </button>
            <button
              type="button"
              id="back-to-login-btn"
              onClick={() => switchMode("login")}
              className="inline-flex w-full items-center justify-center space-x-1 text-xs font-bold text-orange-600 hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Retour à la connexion</span>
            </button>
          </form>
        ) : mode === "register" && confirmationEmailSentTo ? (
          <div className="space-y-4 text-center" id="registration-confirmation-sent-view">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Mail className="h-6 w-6" />
            </div>
            <p className="text-sm font-black text-gray-900">Votre compte est créé. Une dernière étape.</p>
            <p className="text-sm font-semibold text-gray-700">
              Ouvrez l'e-mail envoyé à <span className="text-orange-600">{confirmationEmailSentTo}</span> et cliquez
              sur le lien qu'il contient : <strong>vous ne pourrez pas vous connecter avant</strong>.
            </p>

            {/* Étapes explicites : sur mobile, l'utilisateur doit quitter le site pour aller
                dans sa boîte mail. Sans lui dire où il en est ni où il revient, il croit que
                l'inscription a échoué et ferme l'onglet — c'est la fuite principale du tunnel. */}
            <ol className="mx-auto max-w-xs space-y-1.5 text-left text-xs text-gray-500">
              <li className="flex gap-2"><span className="font-black text-orange-600">1.</span> Ouvrez votre application e-mail</li>
              <li className="flex gap-2"><span className="font-black text-orange-600">2.</span> Cliquez sur le lien de confirmation (pensez aux spams et à l'onglet « Promotions »)</li>
              <li className="flex gap-2"><span className="font-black text-orange-600">3.</span> Revenez ici pour vous connecter</li>
            </ol>

            <div className="rounded-xl bg-gray-50 p-3">
              {resendState === "sent" ? (
                <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Nouvel e-mail envoyé. Vérifiez votre boîte de réception.
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-gray-500">E-mail non reçu après une minute ?</p>
                  <button
                    type="button"
                    id="resend-confirmation-btn"
                    onClick={handleResendConfirmation}
                    disabled={resendState === "sending"}
                    className="mt-1 text-xs font-black text-orange-600 hover:underline disabled:text-gray-400 disabled:no-underline"
                  >
                    {resendState === "sending" ? "Envoi en cours..." : "Renvoyer le lien de confirmation"}
                  </button>
                  {resendState === "error" && (
                    <p className="mt-1 text-[11px] font-semibold text-red-500">
                      Renvoi impossible pour le moment. Réessayez dans quelques minutes.
                    </p>
                  )}
                </>
              )}
            </div>

            <button
              id="back-to-login-btn"
              onClick={() => switchMode("login")}
              className="inline-flex min-h-11 items-center space-x-1 rounded-lg px-2 text-xs font-bold text-orange-600 hover:underline sm:min-h-0 sm:px-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>J'ai confirmé, je me connecte</span>
            </button>
          </div>
        ) : mode === "forgot" && forgotPasswordSent ? (
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
              className="inline-flex min-h-11 items-center space-x-1 rounded-lg px-2 text-xs font-bold text-orange-600 hover:underline sm:min-h-0 sm:px-0"
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
                    // Le serveur impose MIN_PASSWORD_LENGTH (server/lib/validators.ts). Cette
                    // borne valait 6 côté navigateur : le formulaire acceptait donc une saisie
                    // que l'API refusait ensuite, et l'utilisateur découvrait la vraie règle
                    // par un message d'erreur, mot de passe déjà choisi.
                    minLength={mode === "login" ? undefined : MIN_PASSWORD_LENGTH}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
                  />
                </div>

                {/* Règles annoncées AVANT la saisie, jamais après le refus : la vérification
                    anti-fuite du serveur peut rejeter un mot de passe pourtant assez long, et
                    ce refus surprise en fin de parcours mobile fait abandonner. */}
                {mode !== "login" && (
                  <ul className="space-y-0.5 pt-1 text-[11px]" id="password-rules-hint">
                    <li className={password.length >= MIN_PASSWORD_LENGTH ? "font-semibold text-emerald-600" : "text-gray-400"}>
                      {password.length >= MIN_PASSWORD_LENGTH ? "✓" : "•"} Au moins {MIN_PASSWORD_LENGTH} caractères
                    </li>
                    <li className="text-gray-400">
                      • Évitez un mot de passe déjà utilisé ailleurs : ceux apparus dans une fuite connue sont refusés
                    </li>
                  </ul>
                )}
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

                {/* Ce choix n'est pas symétrique : s'inscrire directement comme organisateur
                    est immédiat, alors que passer d'acheteur à organisateur ensuite passe par
                    une demande validée par un administrateur (cf. BecomeOrganizerCard). Il
                    n'était signalé nulle part — un organisateur qui cochait « Acheteur » par
                    réflexe se retrouvait bloqué en file d'attente humaine sans l'avoir voulu. */}
                <p className="text-[11px] leading-relaxed text-gray-500" id="auth-role-hint">
                  {role === "organizer"
                    ? "Vous pourrez créer votre premier événement dès la connexion. Sa publication passe par une validation de notre équipe."
                    : "Vous voulez vendre des billets ? Choisissez « Organisateur » maintenant : basculer plus tard demande une validation de notre équipe."}
                </p>
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
        {!forgotPasswordSent && !mfaRequired && !confirmationEmailSentTo && (
          <div className="mt-6 border-t border-gray-100 pt-5 text-center space-y-4">
            {mode === "forgot" ? (
              <button
                id="back-to-login-btn"
                onClick={() => switchMode("login")}
                className="inline-flex min-h-11 items-center space-x-1 rounded-lg px-2 text-xs font-bold text-orange-600 hover:underline sm:min-h-0 sm:px-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Retour à la connexion</span>
              </button>
            ) : mode === "reset" ? null : (
              <button
                id="toggle-auth-mode-btn"
                onClick={() => switchMode(mode === "login" ? "register" : "login")}
                className="inline-flex min-h-11 items-center space-x-1 rounded-lg px-2 text-xs font-bold text-orange-600 hover:underline sm:min-h-0 sm:px-0"
              >
                <span>{mode === "login" ? "Nouveau sur ClicBillet ? Créer un compte" : "Déjà membre ? Se connecter"}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Cancel actions */}
        <button
          onClick={onCancel}
          id="auth-cancel-btn"
          className="mt-2 min-h-11 w-full rounded-lg text-center text-xs font-bold text-gray-400 hover:text-gray-600 sm:mt-4 sm:min-h-0"
        >
          Retourner à l'accueil
        </button>
      </div>
    </div>
  );
}
