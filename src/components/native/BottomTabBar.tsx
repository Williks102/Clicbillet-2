import { Home, Search, Ticket, LayoutDashboard, Camera, ShieldCheck, User as UserIcon, LogIn } from "lucide-react";
import { User } from "../../types";

interface Tab {
  key: string;
  label: string;
  icon: typeof Home;
  onSelect: () => void;
  isActive: boolean;
}

interface BottomTabBarProps {
  user: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onFocusSearch: () => void;
  onOpenAuth: () => void;
}

// Barre d'onglets fixe en bas d'écran (pattern natif iOS/Android), affichée uniquement
// quand l'app tourne dans le conteneur Capacitor (cf. isNativeApp()) — remplace le Navbar
// web du haut. Reprend les mêmes destinations que Navbar/MobileNavDrawer, adaptées au rôle.
export default function BottomTabBar({ user, activeTab, setActiveTab, onFocusSearch, onOpenAuth }: BottomTabBarProps) {
  const tabs: Tab[] = [
    { key: "home", label: "Accueil", icon: Home, onSelect: () => setActiveTab("home"), isActive: activeTab === "home" },
    { key: "search", label: "Recherche", icon: Search, onSelect: onFocusSearch, isActive: false },
  ];

  if (!user) {
    tabs.push({ key: "auth", label: "Connexion", icon: LogIn, onSelect: onOpenAuth, isActive: false });
  } else if (user.role === "admin") {
    tabs.push({
      key: "admin-dashboard", label: "Supervision", icon: ShieldCheck,
      onSelect: () => setActiveTab("admin-dashboard"), isActive: activeTab === "admin-dashboard",
    });
    tabs.push({
      key: "scanner", label: "Scanner", icon: Camera,
      onSelect: () => setActiveTab("scanner"), isActive: activeTab === "scanner",
    });
  } else if (user.role === "organizer") {
    tabs.push({
      key: "organizer-dashboard", label: "Tableau de bord", icon: LayoutDashboard,
      onSelect: () => setActiveTab("organizer-dashboard"), isActive: activeTab === "organizer-dashboard" || activeTab === "create-event",
    });
    tabs.push({
      key: "scanner", label: "Scanner", icon: Camera,
      onSelect: () => setActiveTab("scanner"), isActive: activeTab === "scanner",
    });
  } else {
    tabs.push({
      key: "client-dashboard", label: "Billets", icon: Ticket,
      onSelect: () => setActiveTab("client-dashboard"), isActive: activeTab === "client-dashboard",
    });
  }

  if (user) {
    tabs.push({
      key: "profile", label: "Profil", icon: UserIcon,
      onSelect: () => setActiveTab("profile"), isActive: activeTab === "profile",
    });
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-100 bg-white/95 backdrop-blur-sm print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      id="native-bottom-tab-bar"
    >
      <div className="mx-auto flex max-w-lg items-stretch">
        {tabs.map(({ key, label, icon: Icon, onSelect, isActive }) => (
          <button
            key={key}
            onClick={onSelect}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition-colors active:scale-95 ${
              isActive ? "text-orange-600" : "text-gray-400"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
