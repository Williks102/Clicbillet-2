import { useState } from "react";
import { KeyRound, LogOut, FileText, ShieldCheck, ChevronRight, Ticket, LayoutDashboard, CheckCircle2 } from "lucide-react";
import { User } from "../types";

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

export default function ProfilePage({ user, onLogout, setActiveTab }: ProfilePageProps) {
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function handleResetPassword() {
    setResetLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      </div>

      <div className="mt-6 space-y-3">
        {user.role === "client" && (
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
