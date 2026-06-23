import { motion } from "motion/react";
import { Ticket, LogOut, User as UserIcon, LayoutDashboard, Camera, ShieldCheck, X, Home } from "lucide-react";
import { User } from "../types";

interface MobileNavDrawerProps {
  user: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  onOpenAuth: () => void;
  onClose: () => void;
}

/**
 * Tiroir de navigation latéral pour mobile (sm:hidden), ouvert via le bouton hamburger du
 * Navbar. Reprend les mêmes destinations que la nav desktop, mais avec libellés complets
 * (la nav desktop ne montre que des icônes sur petit écran).
 */
export default function MobileNavDrawer({ user, activeTab, setActiveTab, onLogout, onOpenAuth, onClose }: MobileNavDrawerProps) {
  function go(tab: string) {
    setActiveTab(tab);
    onClose();
  }

  return (
    <div
      id="mobile-nav-drawer-overlay"
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs sm:hidden"
      onClick={onClose}
    >
      <motion.div
        id="mobile-nav-drawer-panel"
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 left-0 flex h-full w-[80%] max-w-xs flex-col bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-orange-100 px-5 py-4 shrink-0">
          <div className="flex items-center space-x-2 text-orange-600">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 font-bold text-white shadow-md shadow-orange-200">
              <Ticket className="h-4.5 w-4.5 rotate-12" />
            </div>
            <span className="text-lg font-extrabold tracking-tight text-gray-900">
              clic<span className="text-orange-600">billet</span>
            </span>
          </div>
          <button
            id="mobile-nav-close-btn"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
            title="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <button
            id="mobile-nav-home-btn"
            onClick={() => go("home")}
            className={`flex w-full items-center space-x-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${
              activeTab === "home" ? "bg-orange-50 text-orange-600" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Home className="h-4.5 w-4.5" />
            <span>Accueil</span>
          </button>

          {user && (
            <>
              {user.role === "admin" ? (
                <button
                  id="mobile-nav-admin-btn"
                  onClick={() => go("admin-dashboard")}
                  className={`flex w-full items-center space-x-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${
                    activeTab === "admin-dashboard" ? "bg-slate-100 text-slate-900" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <ShieldCheck className="h-4.5 w-4.5 text-orange-600" />
                  <span>Supervision</span>
                </button>
              ) : user.role === "client" ? (
                <button
                  id="mobile-nav-client-btn"
                  onClick={() => go("client-dashboard")}
                  className={`flex w-full items-center space-x-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${
                    activeTab === "client-dashboard" ? "bg-orange-50 text-orange-600" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <Ticket className="h-4.5 w-4.5" />
                  <span>Mes Billets</span>
                </button>
              ) : (
                <>
                  <button
                    id="mobile-nav-organizer-btn"
                    onClick={() => go("organizer-dashboard")}
                    className={`flex w-full items-center space-x-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${
                      activeTab === "organizer-dashboard" || activeTab === "create-event"
                        ? "bg-orange-50 text-orange-600"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <LayoutDashboard className="h-4.5 w-4.5" />
                    <span>Tableau de bord</span>
                  </button>
                  <button
                    id="mobile-nav-scanner-btn"
                    onClick={() => go("scanner")}
                    className={`flex w-full items-center space-x-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${
                      activeTab === "scanner" ? "bg-green-50 text-green-600" : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Camera className="h-4.5 w-4.5" />
                    <span>Scanner</span>
                  </button>
                </>
              )}
            </>
          )}
        </nav>

        {/* Footer: user info + logout / login */}
        <div className="border-t border-gray-100 px-4 py-4 shrink-0">
          {user ? (
            <>
              <div className="mb-3 flex items-center space-x-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                <UserIcon className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="flex-1 truncate">{user.name}</span>
                <span className={`shrink-0 rounded-sm px-1 py-0.5 text-[9px] uppercase font-black ${
                  user.role === "admin"
                    ? "bg-purple-100 text-purple-800"
                    : user.role === "organizer"
                    ? "bg-orange-100 text-orange-850"
                    : "bg-blue-100 text-blue-800"
                }`}>
                  {user.role === "admin" ? "Admin" : user.role === "organizer" ? "Orga" : "Client"}
                </span>
              </div>
              <button
                id="mobile-nav-logout-btn"
                onClick={() => { onLogout(); onClose(); }}
                className="flex w-full items-center justify-center space-x-2 rounded-xl bg-gray-50 px-4 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="h-4 w-4" />
                <span>Se déconnecter</span>
              </button>
            </>
          ) : (
            <button
              id="mobile-nav-login-btn"
              onClick={() => { onOpenAuth(); onClose(); }}
              className="flex w-full items-center justify-center space-x-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-200 transition-all hover:bg-orange-700"
            >
              <UserIcon className="h-4 w-4" />
              <span>Se Connecter</span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
