import { useState } from "react";
import { motion } from "motion/react";
import { Menu, X, ChevronDown } from "lucide-react";

export interface DashboardMobileMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onSelect: () => void;
}

interface DashboardMobileMenuProps {
  title: string;
  activeLabel: string;
  items: DashboardMobileMenuItem[];
}

/**
 * Remplace, sous le breakpoint "lg", la nav par onglets des dashboards admin/organisateur
 * (normalement une rangée/sidebar toujours visible) par un déclencheur hamburger qui ouvre
 * un tiroir latéral listant les sections — comme le menu admin mobile de WordPress.
 */
export default function DashboardMobileMenu({ title, activeLabel, items }: DashboardMobileMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        id="dashboard-mobile-menu-trigger"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 shadow-xs transition-colors hover:border-orange-200 hover:text-orange-600"
      >
        <span className="flex items-center space-x-2">
          <Menu className="h-4 w-4 text-orange-600" />
          <span>{activeLabel}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400" />
      </button>

      {open && (
        <div
          id="dashboard-mobile-menu-overlay"
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs"
          onClick={() => setOpen(false)}
        >
          <motion.div
            id="dashboard-mobile-menu-panel"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 left-0 flex h-full w-[80%] max-w-xs flex-col bg-white shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
              <span className="text-sm font-black text-gray-900">{title}</span>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
                title="Fermer le menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {items.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    item.onSelect();
                    setOpen(false);
                  }}
                  className={`flex w-full items-center space-x-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${
                    item.active ? "bg-orange-50 text-orange-600" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </motion.div>
        </div>
      )}
    </div>
  );
}
