import { useState, useEffect } from "react";
import Navbar from "./components/Navbar";
import LandingPage from "./components/LandingPage";
import AuthPage from "./components/AuthPage";
import ClientDashboard from "./components/ClientDashboard";
import OrganizerDashboard from "./components/OrganizerDashboard";
import QrScannerTab from "./components/QrScannerTab";
import CheckoutModal from "./components/CheckoutModal";
import AdminDashboard from "./components/AdminDashboard";
import WaitingRoom from "./components/WaitingRoom";
import ToastStack, { ToastItem } from "./components/ToastStack";
import { User, Event } from "./types";
import { Calendar, Compass, ShieldAlert, Sparkles } from "lucide-react";
import { supabaseClient } from "./lib/supabaseClient";
import { cachedFetch } from "./lib/fetchCache";

export default function App() {
  const [user, setUser] = useState<User | null>((() => {
    try {
      const stored = localStorage.getItem("clicbillet-user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  })());

  const [activeTab, setActiveTab] = useState<string>("home");
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [checkoutEvent, setCheckoutEvent] = useState<Event | null>(null);
  const [waitingRoomEvent, setWaitingRoomEvent] = useState<Event | null>(null);
  const [pendingEvent, setPendingEvent] = useState<Event | null>(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [systemAlert, setSystemAlert] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function pushToast(message: string) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Fetch events list on server side. force=true bypasse le cache client (après une
  // mutation connue : achat de ticket, création d'événement) pour ne pas afficher de
  // données obsolètes pendant les ~20s de fraîcheur du cache.
  async function fetchEvents(force = false) {
    setLoadingEvents(true);
    try {
      const data = await cachedFetch<Event[]>("/api/events", { ttlMs: 20_000, force });
      setEvents(data);
    } catch (err: any) {
      console.error(err);
      setSystemAlert("Erreur de liaison réseau avec les serveurs de paiement ClicBillet.");
    } finally {
      setLoadingEvents(false);
    }
  }

  useEffect(() => {
    fetchEvents();
    
    const params = new URLSearchParams(window.location.search);
    if ((import.meta as any).env?.DEV && params.get("payment_success") === "true") {
      const orderId = params.get("order_id");
      if (orderId) {
        console.log("Validation du paiement post-redirection en développement pour la commande :", orderId);
        fetch("/api/dev/simulate-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ referenceNumber: orderId })
        }).then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          window.dispatchEvent(new CustomEvent("refresh_tickets"));
          if (user?.role === "client") {
            setActiveTab("client-dashboard");
          }
        }).catch(e => console.error("Could not simulate redirect payment:", e));
      }
    }
  }, [user]);

  useEffect(() => {
    // Dynamic tab routing after refreshing user session
    if (user) {
      if (user.role === "admin") {
        setActiveTab("admin-dashboard");
      } else if (user.role === "organizer") {
        setActiveTab("organizer-dashboard");
      }
    }
  }, []);

  // Confirmation de paiement instantanée : on s'abonne aux changements de SES PROPRES
  // tickets via Supabase Realtime (policy "tickets_select_own", scoped à buyer_id = auth.uid()).
  // Dès qu'un ticket passe de PENDING- à PAID- (confirmé par le webhook PaiementPro côté
  // serveur), on affiche un toast et on rafraîchit la liste de billets affichée.
  useEffect(() => {
    if (!supabaseClient || !user?.id || !user?.token) return;

    supabaseClient.realtime.setAuth(user.token);

    const channel = supabaseClient
      .channel(`tickets-buyer-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tickets", filter: `buyer_id=eq.${user.id}` },
        (payload) => {
          const oldRef = String((payload.old as any)?.transaction_ref || "");
          const newRef = String((payload.new as any)?.transaction_ref || "");
          if (oldRef.startsWith("PENDING-") && newRef.startsWith("PAID-")) {
            const eventTitle = (payload.new as any)?.event_title || "votre événement";
            pushToast(`Paiement confirmé ! Votre billet pour "${eventTitle}" est prêt.`);
            window.dispatchEvent(new CustomEvent("refresh_tickets"));
          }
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [user?.id, user?.token]);

  function handleLoginSuccess(loggedInUser: User) {
    setUser(loggedInUser);
    localStorage.setItem("clicbillet-user", JSON.stringify(loggedInUser));
    setAuthModalVisible(false);

    // Dynamic redirect based on user role
    if (loggedInUser.role === "admin") {
      setActiveTab("admin-dashboard");
      setPendingEvent(null);
    } else if (loggedInUser.role === "organizer") {
      setActiveTab("organizer-dashboard");
      setPendingEvent(null);
    } else {
      // If client logging in after clicking "Acheter", we resume checkout!
      if (pendingEvent) {
        openCheckoutFlow(pendingEvent);
        setPendingEvent(null);
      } else {
        setActiveTab("client-dashboard");
      }
    }
  }

  function handleTokenRefresh(token: string, refreshToken?: string) {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, token, ...(refreshToken ? { refreshToken } : {}) };
      localStorage.setItem("clicbillet-user", JSON.stringify(updated));
      return updated;
    });
  }

  function handleLogout() {
    setUser(null);
    localStorage.removeItem("clicbillet-user");
    setCheckoutEvent(null);
    setWaitingRoomEvent(null);
    setPendingEvent(null);
    setAuthModalVisible(false);
    setActiveTab("home");
  }

  // Route vers la salle d'attente si l'événement est en forte affluence, sinon checkout direct.
  function openCheckoutFlow(event: Event) {
    if (event.waitingRoomEnabled) {
      setWaitingRoomEvent(event);
    } else {
      setCheckoutEvent(event);
    }
  }

  function handleBuyTicketTrigger(event: Event) {
    if (!user) {
      // Needs Auth first to attribute ticket purchase - do not open checkout until logged in!
      setPendingEvent(event);
      setAuthModalVisible(true);
    } else {
      openCheckoutFlow(event);
    }
  }

  function handleCheckoutSuccess(tickets: any[]) {
    setCheckoutEvent(null);
    // Refresh events lists to reflect decremented ticket inventory instantly (force=true
    // pour contourner le cache client, sinon l'inventaire affiché resterait obsolète
    // jusqu'à expiration du TTL).
    fetchEvents(true);
    // Redirect buyer to their tickets page
    setActiveTab("client-dashboard");
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900" id="main-application-frame">
      {/* Universal header navigation */}
      <Navbar
        user={user}
        onLogout={handleLogout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAuth={() => {
          setCheckoutEvent(null);
          setAuthModalVisible(true);
        }}
      />

      {/* Network or database connection alerts */}
      {systemAlert && (
        <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6">
          <div className="flex items-center space-x-2 rounded-xl bg-amber-50 p-3.5 text-xs font-semibold text-amber-700 border border-amber-100">
            <ShieldAlert className="h-4.5 w-4.5 text-amber-600 shrink-0" />
            <span>{systemAlert}</span>
          </div>
        </div>
      )}

      {/* Primary viewport content context router */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        {authModalVisible ? (
          <AuthPage
            onSuccess={handleLoginSuccess}
            onCancel={() => {
              setAuthModalVisible(false);
              setCheckoutEvent(null);
              setPendingEvent(null);
            }}
          />
        ) : (
          <>
            {activeTab === "home" && (
              <>
                {loadingEvents ? (
                  <div className="py-24 text-center" id="global-events-loader">
                    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
                    <p className="mt-4 text-xs font-bold text-gray-500">Mise à jour des événements en cours...</p>
                  </div>
                ) : (
                  <LandingPage
                    events={events}
                    onBuyTicket={handleBuyTicketTrigger}
                    userRole={user?.role}
                  />
                )}
              </>
            )}

            {activeTab === "client-dashboard" && user && (
              <ClientDashboard user={user} onTokenRefresh={handleTokenRefresh} />
            )}

            {activeTab === "organizer-dashboard" && user && user.role === "organizer" && (
              <OrganizerDashboard
                user={user}
                events={events}
                onEventCreated={() => fetchEvents(true)}
                setActiveTab={setActiveTab}
                onTokenRefresh={handleTokenRefresh}
              />
            )}

            {activeTab === "admin-dashboard" && user && user.role === "admin" && (
              <AdminDashboard user={user} onLogout={handleLogout} onTokenRefresh={handleTokenRefresh} />
            )}

            {activeTab === "scanner" && user && user.role === "organizer" && (
              <QrScannerTab user={user} onTokenRefresh={handleTokenRefresh} />
            )}
          </>
        )}
      </main>

      {/* Salle d'attente virtuelle, avant l'accès au checkout sur un événement à forte affluence */}
      {waitingRoomEvent && user && (
        <WaitingRoom
          event={waitingRoomEvent}
          user={user}
          onTokenRefresh={handleTokenRefresh}
          onGranted={() => {
            setCheckoutEvent(waitingRoomEvent);
            setWaitingRoomEvent(null);
          }}
          onCancel={() => setWaitingRoomEvent(null)}
        />
      )}

      {/* Ticket purchases interactive modal */}
      {checkoutEvent && (
        <CheckoutModal
          event={checkoutEvent}
          user={user}
          onClose={() => setCheckoutEvent(null)}
          onSuccess={handleCheckoutSuccess}
          onOpenAuth={() => {
            setAuthModalVisible(true);
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Page Footer */}
      <footer className="mt-auto border-t border-gray-100 bg-white py-6 text-center text-xs text-gray-400 font-semibold uppercase tracking-wider print:hidden">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 clicbillet. Tous droits réservés.</p>
          <div className="flex space-x-4">
            <span className="hover:text-gray-600">Conditions d'Utilisation</span>
            <span>•</span>
            <span className="hover:text-gray-600">Confidentialité 225</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
