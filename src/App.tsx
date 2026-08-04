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
import GuestOrAuthModal, { GuestInfo } from "./components/GuestOrAuthModal";
import ToastStack, { ToastItem } from "./components/ToastStack";
import PwaInstallPrompt from "./components/PwaInstallPrompt";
import TermsPage from "./components/legal/TermsPage";
import PrivacyPage from "./components/legal/PrivacyPage";
import PricingPage from "./components/PricingPage";
import ContactPage from "./components/ContactPage";
import ProfilePage from "./components/ProfilePage";
import OrganizerProfilePage from "./components/OrganizerProfilePage";
import BottomTabBar from "./components/native/BottomTabBar";
import { User, Event } from "./types";
import { Calendar, Compass, ShieldAlert, Sparkles } from "lucide-react";
import { supabaseClient } from "./lib/supabaseClient";
import { fetchPublicEvents } from "./lib/publicEvents";
import { isNativeApp } from "./lib/platform";
import { authFetch } from "./lib/apiClient";

// Calculée une seule fois : Capacitor.isNativePlatform() ne change jamais pendant la vie de l'app.
const nativeApp = isNativeApp();

// Page publique organisateur (/o/:alias) : cette app n'a pas de routing par URL (tout est
// géré par activeTab), donc pour qu'un lien direct partageable fonctionne à froid (ouvert
// depuis Instagram par ex., pas seulement en cliquant depuis l'accueil), on lit le pathname
// une seule fois au montage — même principe que le token de reset de mot de passe plus bas.
function extractOrganizerAliasFromPath(): string | null {
  const match = /^\/o\/([a-z0-9-]+)\/?$/.exec(window.location.pathname);
  return match ? match[1] : null;
}

export default function App() {
  // La session vit désormais dans un cookie httpOnly (jamais lisible par du JS, cf.
  // server/lib/auth.ts) : on ne peut plus lire un utilisateur "déjà connecté" de façon
  // synchrone depuis localStorage au montage. À la place, on demande au serveur "qui suis-je
  // d'après mon cookie ?" via /api/auth/me, et on affiche un court chargement le temps de la
  // réponse plutôt que de faire confiance à un état mis en cache côté client.
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [viewingOrganizerAlias, setViewingOrganizerAlias] = useState<string | null>(extractOrganizerAliasFromPath);
  const [activeTab, setActiveTab] = useState<string>(() => extractOrganizerAliasFromPath() ? "organizer-profile" : "home");
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [checkoutEvent, setCheckoutEvent] = useState<Event | null>(null);
  const [waitingRoomEvent, setWaitingRoomEvent] = useState<Event | null>(null);
  const [pendingEvent, setPendingEvent] = useState<Event | null>(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [guestChoiceEvent, setGuestChoiceEvent] = useState<Event | null>(null);
  const [guestInfo, setGuestInfo] = useState<GuestInfo | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
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
      const data = await fetchPublicEvents({ ttlMs: 20_000, force });
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

    // Lien de réinitialisation de mot de passe reçu par e-mail (cf. /api/auth/forgot-password) :
    // on ouvre directement l'écran "Choisir un nouveau mot de passe" et on retire le jeton de
    // l'URL pour ne pas le laisser traîner dans l'historique/les logs du navigateur.
    const token = params.get("reset_token");
    if (token) {
      setResetToken(token);
      setAuthModalVisible(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

  }, [user]);

  // Bootstrap de session au montage : interroge /api/auth/me (protégé par le cookie httpOnly)
  // pour savoir si une session valide existe déjà, plutôt que de faire confiance à un état mis
  // en cache côté client. authFetch gère elle-même le rafraîchissement en cas d'access token
  // expiré (401 -> /api/auth/refresh -> nouvel essai), donc un simple GET suffit ici.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/auth/me", { method: "GET" });
        if (cancelled) return;
        if (res.ok) {
          const profile: User = await res.json();
          setUser(profile);
          // Dynamic tab routing après restauration de session — sauf si l'app vient d'être
          // ouverte sur un lien direct /o/:alias (cf. extractOrganizerAliasFromPath), qu'on ne
          // veut jamais écraser par le tableau de bord habituel du rôle connecté.
          if (activeTab !== "organizer-profile") {
            if (profile.role === "admin") setActiveTab("admin-dashboard");
            else if (profile.role === "organizer") setActiveTab("organizer-dashboard");
          }
        }
      } catch {
        // Pas de session valide (ou serveur injoignable) : l'utilisateur reste déconnecté.
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Navigation vers la page publique d'un organisateur (depuis une fiche événement, ou
  // au chargement initial si l'URL est /o/:alias). Met à jour l'URL pour que le lien reste
  // partageable même si on y arrive en cliquant depuis l'intérieur de l'app.
  function handleViewOrganizer(alias: string) {
    setViewingOrganizerAlias(alias);
    setActiveTab("organizer-profile");
    window.history.pushState({}, "", `/o/${alias}`);
  }

  function handleBackFromOrganizerProfile() {
    setViewingOrganizerAlias(null);
    setActiveTab("home");
    window.history.pushState({}, "", "/");
  }

  // Synchronise l'onglet affiché avec les boutons précédent/suivant du navigateur.
  useEffect(() => {
    function handlePopState() {
      const alias = extractOrganizerAliasFromPath();
      if (alias) {
        setViewingOrganizerAlias(alias);
        setActiveTab("organizer-profile");
      } else {
        setViewingOrganizerAlias(null);
        setActiveTab("home");
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Filet de sécurité : si on quitte la page organisateur par un autre chemin que
  // handleBackFromOrganizerProfile (logo, barre d'onglets native, etc.), on remet quand
  // même l'URL sur "/" pour qu'elle ne reste jamais désynchronisée de l'écran affiché.
  useEffect(() => {
    if (activeTab !== "organizer-profile" && window.location.pathname.startsWith("/o/")) {
      window.history.replaceState({}, "", "/");
    }
  }, [activeTab]);

  // Confirmation de paiement instantanée : on s'abonne aux changements de SES PROPRES
  // tickets via Supabase Realtime (policy "tickets_select_own", scoped à buyer_id = auth.uid()).
  // Dès qu'un ticket passe de PENDING- à PAID- (confirmé par le webhook Paystack côté
  // serveur), on affiche un toast et on rafraîchit la liste de billets affichée.
  //
  // Le JWT Supabase brut n'est plus lisible côté client (il vit dans un cookie httpOnly) —
  // Realtime a besoin d'un JWT pour authentifier le canal, donc on en récupère un exprès via
  // /api/auth/realtime-token (seule utilisation légitime restante d'un jeton en clair côté
  // navigateur) : jamais persisté en storage, gardé en mémoire le temps de cet effet seulement,
  // recalculé à chaque changement d'utilisateur.
  useEffect(() => {
    if (!supabaseClient || !user?.id) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabaseClient.channel> | null = null;

    (async () => {
      try {
        const res = await authFetch("/api/auth/realtime-token", { method: "GET" });
        if (cancelled || !res.ok) return;
        const { token } = await res.json();
        if (cancelled || !token) return;

        supabaseClient!.realtime.setAuth(token);
        channel = supabaseClient!
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
      } catch {
        // Pas de session Supabase (repli db.json, ou requête échouée) : pas de temps réel,
        // le rafraîchissement manuel (bouton, pull-to-refresh) reste disponible.
      }
    })();

    return () => {
      cancelled = true;
      if (channel) supabaseClient!.removeChannel(channel);
    };
  }, [user?.id]);

  function handleLoginSuccess(loggedInUser: User) {
    setUser(loggedInUser);
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

  // Révoque la session côté serveur (efface les cookies httpOnly + invalide le refresh token
  // Supabase) avant de réinitialiser l'état local — auparavant purement client
  // (localStorage.removeItem), ce qui laissait un jeton volé valide jusqu'à son expiration
  // naturelle même après une "déconnexion".
  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "X-Requested-With": "ClicBillet" },
        credentials: "include"
      });
    } catch {
      // Best-effort : on nettoie l'état local même si l'appel réseau échoue.
    }
    setUser(null);
    setCheckoutEvent(null);
    setWaitingRoomEvent(null);
    setPendingEvent(null);
    setGuestInfo(null);
    setGuestChoiceEvent(null);
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
      setGuestChoiceEvent(event);
    } else {
      openCheckoutFlow(event);
    }
  }

  function handleGuestContinue(info: GuestInfo) {
    setGuestInfo(info);
    const event = guestChoiceEvent;
    setGuestChoiceEvent(null);
    if (event) openCheckoutFlow(event);
  }

  function handleGuestChooseAuth() {
    const event = guestChoiceEvent;
    setGuestChoiceEvent(null);
    setPendingEvent(event);
    setAuthModalVisible(true);
  }

  function handleCheckoutSuccess(_tickets: any[]) {
    setCheckoutEvent(null);
    // Refresh events lists to reflect decremented ticket inventory instantly (force=true
    // pour contourner le cache client, sinon l'inventaire affiché resterait obsolète
    // jusqu'à expiration du TTL).
    fetchEvents(true);
    // Les invités n'ont pas d'espace "Mes billets" connecté : les renvoyer vers l'accueil
    // évite une page blanche, leurs QR codes étant envoyés par email.
    if (user?.role === "client") {
      setActiveTab("client-dashboard");
    } else {
      setActiveTab("home");
    }
  }

  // Onglet "Recherche" de la barre native : reste sur l'accueil (où vit déjà la recherche
  // événements) et donne le focus au champ, plutôt que de dupliquer un écran de recherche.
  function handleFocusSearch() {
    setActiveTab("home");
    requestAnimationFrame(() => {
      document.getElementById("event-search-input")?.focus();
    });
  }

  // Le temps du bootstrap de session (/api/auth/me), on évite d'afficher un état "déconnecté"
  // qui flasherait avant de basculer vers le tableau de bord si une session valide existe.
  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50" id="session-bootstrap-loader">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900"
      id="main-application-frame"
      style={nativeApp ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
    >
      {/* Universal header navigation (web uniquement — remplacé par la barre d'onglets
          native en bas quand l'app tourne dans Capacitor) */}
      {!nativeApp && (
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
      )}

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
      <main
        className={`flex-1 mx-auto w-full max-w-7xl overflow-hidden px-3 py-6 sm:px-6 sm:py-8 ${nativeApp ? "pb-24" : ""}`}
        style={nativeApp ? { paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)" } : undefined}
      >
        {authModalVisible ? (
          <AuthPage
            onSuccess={handleLoginSuccess}
            initialResetToken={resetToken}
            onCancel={() => {
              setAuthModalVisible(false);
              setResetToken(null);
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
                    onViewOrganizer={handleViewOrganizer}
                  />
                )}
              </>
            )}

            {activeTab === "organizer-profile" && viewingOrganizerAlias && (
              <OrganizerProfilePage
                alias={viewingOrganizerAlias}
                onBack={handleBackFromOrganizerProfile}
                onBuyTicket={handleBuyTicketTrigger}
              />
            )}

            {activeTab === "client-dashboard" && user && (
              <ClientDashboard user={user} />
            )}

            {activeTab === "organizer-dashboard" && user && user.role === "organizer" && (
              <OrganizerDashboard
                user={user}
                events={events}
                onEventCreated={() => fetchEvents(true)}
                setActiveTab={setActiveTab}
              />
            )}

            {activeTab === "admin-dashboard" && user && user.role === "admin" && (
              <AdminDashboard user={user} />
            )}

            {activeTab === "scanner" && user && user.role === "organizer" && (
              <QrScannerTab user={user} />
            )}

            {activeTab === "terms" && <TermsPage onBack={() => setActiveTab("home")} />}

            {activeTab === "privacy" && <PrivacyPage onBack={() => setActiveTab("home")} />}

            {activeTab === "pricing" && (
              <PricingPage
                onBack={() => setActiveTab("home")}
                onCreateAccount={() => setAuthModalVisible(true)}
                onContact={() => setActiveTab("contact")}
              />
            )}

            {activeTab === "contact" && <ContactPage onBack={() => setActiveTab("pricing")} />}

            {activeTab === "profile" && user && (
              <ProfilePage user={user} onLogout={handleLogout} setActiveTab={setActiveTab} />
            )}
          </>
        )}
      </main>

      {/* Salle d'attente virtuelle, avant l'accès au checkout sur un événement à forte affluence */}
      {waitingRoomEvent && user && (
        <WaitingRoom
          event={waitingRoomEvent}
          onGranted={() => {
            setCheckoutEvent(waitingRoomEvent);
            setWaitingRoomEvent(null);
          }}
          onCancel={() => setWaitingRoomEvent(null)}
        />
      )}

      {/* Choix invité / connexion avant l'achat */}
      {guestChoiceEvent && (
        <GuestOrAuthModal
          onGuestContinue={handleGuestContinue}
          onOpenAuth={handleGuestChooseAuth}
          onClose={() => setGuestChoiceEvent(null)}
        />
      )}

      {/* Ticket purchases interactive modal */}
      {checkoutEvent && (
        <CheckoutModal
          event={checkoutEvent}
          user={user}
          guestInfo={guestInfo ?? undefined}
          onClose={() => { setCheckoutEvent(null); setGuestInfo(null); }}
          onSuccess={handleCheckoutSuccess}
          onOpenAuth={() => {
            setAuthModalVisible(true);
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <PwaInstallPrompt />

      {/* Page Footer web (masqué en app native : CGV/Confidentialité/déconnexion vivent déjà
          dans l'onglet Profil de la barre native, un footer "copyright" n'a pas sa place dans
          une app installée). */}
      {!nativeApp && (
        <footer className="mt-auto border-t border-gray-100 bg-white py-6 text-center text-xs text-gray-400 font-semibold uppercase tracking-wider print:hidden">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p>© {new Date().getFullYear()} clicbillet. Tous droits réservés.</p>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <button onClick={() => setActiveTab("pricing")} className="hover:text-gray-600">
                Tarifs
              </button>
              <span>•</span>
              <button onClick={() => setActiveTab("contact")} className="hover:text-gray-600">
                Contact
              </button>
              <span>•</span>
              <button onClick={() => setActiveTab("terms")} className="hover:text-gray-600">
                Conditions Générales de Vente
              </button>
              <span>•</span>
              <button onClick={() => setActiveTab("privacy")} className="hover:text-gray-600">
                Confidentialité
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Barre d'onglets native, fixe en bas — uniquement dans le conteneur Capacitor */}
      {nativeApp && (
        <BottomTabBar
          user={user}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onFocusSearch={handleFocusSearch}
          onOpenAuth={() => {
            setCheckoutEvent(null);
            setAuthModalVisible(true);
          }}
        />
      )}
    </div>
  );
}
