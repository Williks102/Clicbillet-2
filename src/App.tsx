import { useState, useEffect } from "react";
import Navbar from "./components/Navbar";
import LandingPage from "./components/LandingPage";
import AuthPage from "./components/AuthPage";
import ClientDashboard from "./components/ClientDashboard";
import OrganizerDashboard from "./components/OrganizerDashboard";
import QrScannerTab from "./components/QrScannerTab";
import CheckoutModal from "./components/CheckoutModal";
import AdminDashboard from "./components/AdminDashboard";
import { User, Event } from "./types";
import { Calendar, Compass, ShieldAlert, Sparkles } from "lucide-react";

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
  const [pendingEvent, setPendingEvent] = useState<Event | null>(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [systemAlert, setSystemAlert] = useState<string | null>(null);

  // Fetch events list on server side
  async function fetchEvents() {
    setLoadingEvents(true);
    try {
      const response = await fetch("/api/events");
      if (!response.ok) {
        throw new Error("Impossible de communiquer avec la billetterie backend.");
      }
      const data = await response.json();
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
    
    // Check if coming back from PaiementPro success URL
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment_success") === "true") {
      const ticketId = params.get("ticket_id");
      if (ticketId) {
        console.log("Validation du paiement post-redirection pour:", ticketId);
        // Force the webhook via frontend to mark as SUCCESS because local dev might not receive external webhooks
        fetch("/api/payment/callback", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ referenceNumber: ticketId, status: "SUCCESS" })
        }).then(() => {
          // Clean the URL purely for visual purposes
          window.history.replaceState({}, document.title, window.location.pathname);
          // Navigate to tickets page
          if (user?.role === "client") {
            setActiveTab("client-dashboard");
          }
        }).catch(e => console.error("Could not validate redirect payment:", e));
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
        setCheckoutEvent(pendingEvent);
        setPendingEvent(null);
      } else {
        setActiveTab("client-dashboard");
      }
    }
  }

  function handleLogout() {
    setUser(null);
    localStorage.removeItem("clicbillet-user");
    setCheckoutEvent(null);
    setPendingEvent(null);
    setAuthModalVisible(false);
    setActiveTab("home");
  }

  function handleBuyTicketTrigger(event: Event) {
    if (!user) {
      // Needs Auth first to attribute ticket purchase - do not open checkout until logged in!
      setPendingEvent(event);
      setAuthModalVisible(true);
    } else {
      setCheckoutEvent(event);
    }
  }

  function handleCheckoutSuccess(ticket: any) {
    setCheckoutEvent(null);
    // Refresh events lists to reflect decremented ticket inventory instantly
    fetchEvents();
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
              <ClientDashboard user={user} />
            )}

            {activeTab === "organizer-dashboard" && user && user.role === "organizer" && (
              <OrganizerDashboard
                user={user}
                events={events}
                onEventCreated={fetchEvents}
                setActiveTab={setActiveTab}
              />
            )}

            {activeTab === "admin-dashboard" && user && user.role === "admin" && (
              <AdminDashboard user={user} onLogout={handleLogout} />
            )}

            {activeTab === "scanner" && user && user.role === "organizer" && (
              <QrScannerTab organizerId={user.id} />
            )}
          </>
        )}
      </main>

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
