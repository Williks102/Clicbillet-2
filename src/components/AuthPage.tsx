import React, { useState } from "react";
import { Mail, Lock, User as UserIcon, LogIn, ArrowRight, CheckCircle2, Ticket } from "lucide-react";
import { User, UserRole } from "../types";

interface AuthPageProps {
  onSuccess: (user: User) => void;
  onCancel: () => void;
}

export default function AuthPage({ onSuccess, onCancel }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("client");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const payload = isLogin 
      ? { email, password }
      : { email, password, name, role };

    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";

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

      // Success! Pass user state upstairs
      onSuccess(data);
    } catch (err: any) {
      setError(err.message || "Impossible de se connecter au serveur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-12" id="auth-page-container">
      <div className="rounded-2xl border border-orange-50 bg-white p-6 shadow-xl sm:p-8">
        
        {/* Brand visual header inside card */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-600 font-bold text-white shadow-lg shadow-orange-100">
            <Ticket className="h-7 w-7 rotate-12" />
          </div>
          <h2 className="mt-4 text-xl font-black text-gray-900">
            {isLogin ? "Ravi de vous revoir !" : "Créer votre compte clicbillet"}
          </h2>
          <p className="mt-1.5 text-xs text-gray-500">
            {isLogin ? "Accédez à vos billets et statistiques en un instant" : "Rejoignez la billetterie la plus innovante de Côte d'Ivoire"}
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg bg-red-50 p-3.5 text-xs font-semibold text-red-600 border border-red-100" id="auth-error-alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Complete Name field - only active on registration */}
          {!isLogin && (
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

          {/* Email Address field */}
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

          {/* Password field */}
          <div className="space-y-1" id="auth-password-field">
            <label className="text-xs font-bold text-gray-700 font-sans">Mot de passe</label>
            <div className="relative">
              <Lock className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-3 pr-4 pl-10 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-100 placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Role selector - only active on registration */}
          {!isLogin && (
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
            ) : (
              <>
                <span>{isLogin ? "Se connecter" : "S'inscrire avec e-mail"}</span>
                <LogIn className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        {/* Toggle between Login / Sign Up */}
        <div className="mt-6 border-t border-gray-100 pt-5 text-center space-y-4">
          <button
            id="toggle-auth-mode-btn"
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
            }}
            className="inline-flex items-center space-x-1 text-xs font-bold text-orange-600 hover:underline"
          >
            <span>{isLogin ? "Nouveau sur ClicBillet ? Créer un compte" : "Déjà membre ? Se connecter"}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>

          <div className="rounded-xl bg-orange-50/70 p-3 text-center text-xs text-orange-800 border border-orange-100 space-y-1">
            <span className="font-black">� Mode démo :</span>
            <div className="font-mono text-[10px] bg-white rounded-md p-1 border border-orange-100">
              Créez un compte ou utilisez les identifiants fournis par l'administrateur de la plateforme.
            </div>
          </div>
        </div>

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
