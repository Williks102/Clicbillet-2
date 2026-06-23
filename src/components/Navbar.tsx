import { useState } from "react";
import { Ticket, LogOut, User as UserIcon, LayoutDashboard, Calendar, Camera, ShieldCheck, Menu } from "lucide-react";
import { User } from "../types";
import MobileNavDrawer from "./MobileNavDrawer";

interface NavbarProps {
  user: User | null;
  onLogout: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenAuth: () => void;
}

export default function Navbar({ user, onLogout, activeTab, setActiveTab, onOpenAuth }: NavbarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-orange-100 bg-white/95 shadow-xs backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Brand Logo */}
        <div
          onClick={() => setActiveTab("home")}
          className="flex cursor-pointer items-center space-x-2 text-orange-600 transition-transform active:scale-95"
          id="logo-brand-container"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 font-bold text-white shadow-md shadow-orange-200">
            <Ticket className="h-5 w-5 rotate-12" />
          </div>
          <span className="text-xl font-extrabold tracking-tight text-gray-900">
            clic<span className="text-orange-600">billet</span>
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3" id="nav-actions-container">
          {/* Nav complète (texte + icônes), visible à partir de "sm" (tablette/desktop). Sur
              mobile, ces destinations sont accessibles via le tiroir hamburger ci-dessous. */}
          <div className="hidden items-center space-x-3 sm:flex">
            {user ? (
              <>
                {/* User Dashboard Tab Selector */}
                {user.role === "admin" ? (
                  <button
                    id="tab-admin-dashboard-btn"
                    onClick={() => setActiveTab("admin-dashboard")}
                    className={`flex items-center space-x-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      activeTab === "admin-dashboard"
                        ? "bg-slate-100 text-slate-900 border border-slate-200"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-950"
                    }`}
                  >
                    <ShieldCheck className="h-4 w-4 text-orange-600" />
                    <span>Supervision</span>
                  </button>
                ) : user.role === "client" ? (
                  <button
                    id="tab-client-dashboard-btn"
                    onClick={() => setActiveTab("client-dashboard")}
                    className={`flex items-center space-x-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      activeTab === "client-dashboard"
                        ? "bg-orange-50 text-orange-600"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Ticket className="h-4 w-4" />
                    <span>Mes Billets</span>
                  </button>
                ) : (
                  <>
                    <button
                      id="tab-organizer-dashboard-btn"
                      onClick={() => setActiveTab("organizer-dashboard")}
                      className={`flex items-center space-x-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                        activeTab === "organizer-dashboard" || activeTab === "create-event"
                          ? "bg-orange-50 text-orange-600"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      <span>Tableau de bord</span>
                    </button>
                    <button
                      id="tab-scanner-btn"
                      onClick={() => setActiveTab("scanner")}
                      className={`flex items-center space-x-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                        activeTab === "scanner"
                          ? "bg-green-50 text-green-600"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      <Camera className="h-4 w-4" />
                      <span>Scanner</span>
                    </button>
                  </>
                )}

                {/* User Information */}
                <div className="hidden items-center space-x-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs font-semibold text-gray-700 md:flex">
                  <UserIcon className="h-3.5 w-3.5 text-gray-400" />
                  <span className="max-w-[120px] truncate">{user.name}</span>
                  <span className={`rounded-sm px-1 py-0.5 text-[9px] uppercase font-black ${
                    user.role === "admin"
                      ? "bg-purple-100 text-purple-800"
                      : user.role === "organizer"
                      ? "bg-orange-100 text-orange-850"
                      : "bg-blue-100 text-blue-800"
                  }`}>
                    {user.role === "admin" ? "Admin" : user.role === "organizer" ? "Orga" : "Client"}
                  </span>
                </div>

                {/* Sign Out Button */}
                <button
                  id="logout-button"
                  onClick={onLogout}
                  title="Se déconnecter"
                  className="flex items-center space-x-1 rounded-xl bg-gray-50 p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden text-sm font-medium lg:inline">Quitter</span>
                </button>
              </>
            ) : (
              <button
                id="open-auth-btn"
                onClick={onOpenAuth}
                className="flex items-center space-x-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white shadow-md shadow-orange-200 transition-all hover:bg-orange-700 active:scale-95"
              >
                <UserIcon className="h-4 w-4" />
                <span>Se Connecter</span>
              </button>
            )}
          </div>

          {/* Déclencheur du tiroir de navigation latéral, mobile uniquement */}
          <button
            id="mobile-nav-trigger-btn"
            onClick={() => setDrawerOpen(true)}
            title="Ouvrir le menu"
            className="flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2.5 text-gray-700 shadow-xs transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 active:scale-95 sm:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {drawerOpen && (
        <MobileNavDrawer
          user={user}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onLogout={onLogout}
          onOpenAuth={onOpenAuth}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </header>
  );
}
