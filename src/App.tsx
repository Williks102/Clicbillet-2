import { useState, useEffect, useRef, lazy, Suspense } from "react";
import Navbar from "./components/Navbar";
import LandingPage from "./components/LandingPage";
import AuthPage from "./components/AuthPage";
import CheckoutModal from "./components/CheckoutModal";
import WaitingRoom from "./components/WaitingRoom";
import GuestOrAuthModal, { GuestInfo } from "./components/GuestOrAuthModal";
import ToastStack, { ToastItem } from "./components/ToastStack";
import PwaInstallPrompt from "./components/PwaInstallPrompt";
import JoinPromoterCta from "./components/JoinPromoterCta";
import JoinVendorCta from "./components/JoinVendorCta";
import { EventGridSkeleton, PageSkeleton } from "./components/Skeleton";
import OrganizerProfilePage from "./components/OrganizerProfilePage";
import BottomTabBar from "./components/native/BottomTabBar";

// Écrans chargés à la demande. Tout partait auparavant dans un fichier unique de 1,4 Mo :
// un acheteur venu prendre un billet téléchargeait la supervision, le tableau de bord
// organisateur, les rapports et la bibliothèque de scan de QR codes avant de voir quoi que ce
// soit. Ces écrans-là ne concernent qu'une fraction des visiteurs, et jamais au premier
// affichage — d'où le découpage. L'accueil, l'authentification et le paiement restent, eux,
// dans le bundle principal : ce sont eux le chemin critique.
const ClientDashboard = lazy(() => import("./components/ClientDashboard"));
const OrganizerDashboard = lazy(() => import("./components/OrganizerDashboard"));
const AdminDashboard = lazy(() => import("./components/AdminDashboard"));
const QrScannerTab = lazy(() => import("./components/QrScannerTab"));
const TermsPage = lazy(() => import("./components/legal/TermsPage"));
const PrivacyPage = lazy(() => import("./components/legal/PrivacyPage"));
const PricingPage = lazy(() => import("./components/PricingPage"));
const ContactPage = lazy(() => import("./components/ContactPage"));
const ProfilePage = lazy(() => import("./components/ProfilePage"));
const EventPage = lazy(() => import("./components/EventPage"));
const VendorsMarketplacePage = lazy(() => import("./components/VendorsMarketplacePage"));
const VendorProfilePage = lazy(() => import("./components/VendorProfilePage"));
const VendorDashboard = lazy(() => import("./components/VendorDashboard"));

// Repli affiché le temps de récupérer le morceau de code d'un écran. Sur une connexion correcte
// il n'apparaît qu'une fraction de seconde ; sur un réseau mobile lent, il tient l'écran assez
// longtemps pour qu'un disque qui tourne devienne pesant — d'où la forme de l'écran à venir.
function ScreenLoader() {
  return <PageSkeleton />;
}
import { User, Event } from "./types";
import { Calendar, Compass, ShieldAlert, Sparkles } from "lucide-react";
import { supabaseClient } from "./lib/supabaseClient";
import { fetchPublicEvents } from "./lib/publicEvents";
import { isNativeApp } from "./lib/platform";
import { matchPath, pathForTab } from "./lib/appRoutes";
import { authFetch } from "./lib/apiClient";

// Calculée une seule fois : Capacitor.isNativePlatform() ne change jamais pendant la vie de l'app.
const nativeApp = isNativeApp();

// Écran demandé par l'URL d'ouverture. Lu une seule fois : c'est le point d'entrée "à froid"
// (lien reçu par message, favori, résultat de recherche), par opposition à la navigation
// interne qui passe ensuite par setActiveTab.
const initialRoute = matchPath(window.location.pathname);

// L'écran d'authentification n'est pas un onglet comme les autres : il remplace le contenu
// principal. On retient donc séparément « quel écran d'authentification afficher », et l'onglet
// conserve la destination vers laquelle revenir en cas d'abandon.
type AuthScreen = "login" | "register";
const initialAuthScreen: AuthScreen | null =
  initialRoute.tab === "login" || initialRoute.tab === "register" ? initialRoute.tab : null;

export default function App() {
  // La session vit désormais dans un cookie httpOnly (jamais lisible par du JS, cf.
  // server/lib/auth.ts) : on ne peut plus lire un utilisateur "déjà connecté" de façon
  // synchrone depuis localStorage au montage. À la place, on demande au serveur "qui suis-je
  // d'après mon cookie ?" via /api/auth/me, et on affiche un court chargement le temps de la
  // réponse plutôt que de faire confiance à un état mis en cache côté client.
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [viewingOrganizerAlias, setViewingOrganizerAlias] = useState<string | null>(initialRoute.organizerAlias);
  const [viewingEventId, setViewingEventId] = useState<string | null>(initialRoute.eventId);
  const [viewingVendorAlias, setViewingVendorAlias] = useState<string | null>(initialRoute.vendorAlias);
  // Onglet affiché derrière l'écran d'authentification : c'est là qu'on revient si l'utilisateur
  // abandonne. Une URL /connexion ouverte à froid retombe donc sur l'accueil à l'annulation.
  const [activeTab, setActiveTab] = useState<string>(initialAuthScreen ? "home" : initialRoute.tab);
  // Écran (sous forme de chemin canonique) que l'URL courante désignait lors du dernier
  // précédent/suivant. Tant que l'état affiché correspond, l'effet de synchronisation n'a rien
  // à empiler : sans quoi il réempilerait aussitôt l'entrée qu'on vient de quitter.
  const routeFromUrl = useRef<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [checkoutEvent, setCheckoutEvent] = useState<Event | null>(null);
  const [waitingRoomEvent, setWaitingRoomEvent] = useState<Event | null>(null);
  // Onglet à ouvrir APRÈS la fermeture de la modale de paiement (cf. handleCheckoutSuccess).
  const [postCheckoutTab, setPostCheckoutTab] = useState<string | null>(null);
  const [pendingEvent, setPendingEvent] = useState<Event | null>(null);
  const [authModalVisible, setAuthModalVisible] = useState(Boolean(initialAuthScreen));
  // Écran d'authentification courant. Il pilote l'URL (/connexion ou /inscription) et suit les
  // bascules faites depuis le formulaire lui-même (« Déjà membre ? Se connecter »), sans quoi
  // l'adresse annoncerait l'inscription pendant qu'on affiche la connexion.
  const [authScreen, setAuthScreen] = useState<AuthScreen>(initialAuthScreen === "register" ? "register" : "login");
  // Pourquoi l'écran d'authentification a été ouvert : "promoter" le fait démarrer sur
  // l'inscription avec le type de compte adéquat. Remis à null à la fermeture, sans quoi une
  // ouverture ultérieure par « Se Connecter » afficherait encore l'inscription.
  const [authIntent, setAuthIntent] = useState<"promoter" | null>(null);
  const [guestChoiceEvent, setGuestChoiceEvent] = useState<Event | null>(null);
  const [guestInfo, setGuestInfo] = useState<GuestInfo | null>(null);
  // Billets choisis sur la page de l'événement. Conservés pendant les détours possibles
  // (choix compte/invité, connexion, file d'attente) pour que la modale de paiement les
  // retrouve intacts et n'ait pas à les redemander.
  const [pendingQuantities, setPendingQuantities] = useState<Record<string, number>>({});
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
      openAuthScreen("login");
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
          // Atterrissage par défaut sur le tableau de bord du rôle — uniquement si l'app a été
          // ouverte sur l'accueil. Un lien direct (tarifs, page organisateur, CGV...) doit
          // rester sur l'écran demandé : c'est tout l'intérêt de l'avoir partagé.
          if (initialRoute.tab === "home") {
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

  // Navigation par la barre de navigation, le tiroir mobile ou le pied de page.
  //
  // Elle DOIT refermer l'écran d'authentification : celui-ci occupe la zone principale à la
  // place de l'onglet demandé, si bien qu'un simple setActiveTab changeait l'URL sans changer
  // l'écran. Une fois cet écran ouvert — par « Se Connecter », par « Devenir promoteur » ou par
  // un lien de réinitialisation — toute la navigation paraissait morte, logo compris : les
  // clics étaient bien reçus, l'adresse changeait, mais le formulaire restait affiché.
  //
  // Les états du parcours d'achat interrompu sont relâchés au passage, comme le fait déjà le
  // bouton « Retourner à l'accueil » de l'écran d'authentification : partir ailleurs vaut
  // abandon. Le jeton de réinitialisation aussi — il est à usage unique et reste valable côté
  // serveur, le lien reçu par e-mail permet de reprendre.
  // Ouverture de l'écran d'authentification. Passe par ici plutôt que par setAuthModalVisible
  // direct : c'est ce qui fixe l'écran affiché, donc l'URL (/connexion ou /inscription).
  function openAuthScreen(screen: AuthScreen) {
    setAuthScreen(screen);
    setAuthModalVisible(true);
  }

  function navigateToTab(tab: string) {
    setAuthModalVisible(false);
    setAuthIntent(null);
    setResetToken(null);
    setCheckoutEvent(null);
    setPendingEvent(null);
    setActiveTab(tab);
  }

  // Navigation vers la page publique d'un organisateur. L'URL est posée par l'effet de
  // synchronisation ci-dessous, comme pour tous les autres écrans.
  function handleViewOrganizer(alias: string) {
    setViewingOrganizerAlias(alias);
    setActiveTab("organizer-profile");
  }

  function handleBackFromOrganizerProfile() {
    setViewingOrganizerAlias(null);
    setActiveTab("home");
  }

  // Navigation vers la fiche publique d'un prestataire (/p/:alias), jumeau de
  // handleViewOrganizer ci-dessus.
  function handleViewVendor(alias: string) {
    setViewingVendorAlias(alias);
    setActiveTab("vendor-profile");
    window.scrollTo({ top: 0 });
  }

  function handleBackFromVendorProfile() {
    setViewingVendorAlias(null);
    setActiveTab("vendors");
  }

  // Boutons précédent/suivant du navigateur : l'URL fait foi, on réaligne l'écran dessus.
  useEffect(() => {
    function handlePopState() {
      const route = matchPath(window.location.pathname);
      // On mémorise l'écran que cette URL désigne, sous sa forme canonique, pour que l'effet
      // ci-dessous sache que l'état vient d'être dérivé de l'URL et n'ait rien à empiler.
      routeFromUrl.current = pathForTab(route.tab, route.organizerAlias, route.eventId, route.vendorAlias);

      // « Précédent » depuis un formulaire d'authentification doit le refermer, et y revenir
      // doit le rouvrir — c'est tout l'intérêt de lui avoir donné une adresse.
      if (route.tab === "login" || route.tab === "register") {
        setAuthScreen(route.tab);
        setAuthModalVisible(true);
        return;
      }
      setAuthModalVisible(false);
      setAuthIntent(null);
      setViewingOrganizerAlias(route.organizerAlias);
      setViewingEventId(route.eventId);
      setViewingVendorAlias(route.vendorAlias);
      setActiveTab(route.tab);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Synchronisation écran -> URL, en un seul endroit : chaque changement d'onglet laisse une
  // entrée d'historique, donc "précédent" revient à l'écran précédent au lieu de quitter
  // l'application, et l'adresse affichée reste toujours celle de l'écran visible — donc
  // copiable et partageable telle quelle.
  useEffect(() => {
    // L'écran d'authentification masque l'onglet courant : c'est donc lui que l'adresse doit
    // annoncer tant qu'il est affiché.
    const nextPath = authModalVisible
      ? pathForTab(authScreen)
      : pathForTab(activeTab, viewingOrganizerAlias, viewingEventId, viewingVendorAlias);

    // État issu d'un précédent/suivant : l'URL est déjà la bonne, empiler ici renverrait
    // l'utilisateur d'où il vient à chaque appui sur « précédent ». On compare l'écran plutôt
    // que de consommer un drapeau à usage unique : si le retour ne change aucun état (retour
    // vers l'écran déjà affiché), React ne re-rend pas, cet effet ne s'exécute pas, et un
    // drapeau resterait posé — faisant sauter la mise à jour d'URL de la navigation SUIVANTE.
    // L'écran et l'adresse divergeaient alors, et le clic sur l'onglet correspondant à l'URL
    // ne produisait plus rien.
    if (nextPath === routeFromUrl.current) return;
    routeFromUrl.current = null;

    if (nextPath !== window.location.pathname) {
      window.history.pushState({}, "", nextPath);
    }
  }, [activeTab, viewingOrganizerAlias, viewingEventId, viewingVendorAlias, authModalVisible, authScreen]);

  // Ouverture de la page d'un événement. C'est désormais ce que fait un clic sur une affiche,
  // à la place de l'ouverture directe de la fenêtre de paiement : sans écran intermédiaire,
  // un événement n'avait aucune URL propre, donc rien à partager.
  function handleViewEvent(event: Event) {
    setViewingEventId(event.id);
    setActiveTab("event");
    window.scrollTo({ top: 0 });
  }

  // « Devenir promoteur » : la destination dépend de l'état de connexion, car le formulaire de
  // demande exige un compte (l'administrateur doit savoir qui rappeler avant d'ouvrir la vente).
  // Un visiteur crée donc d'abord son compte ; un acheteur déjà connecté va droit à son profil,
  // seul endroit où vit le formulaire. Un organisateur ou un administrateur n'arrive jamais ici :
  // le bouton et la bande d'appel à l'action leur sont masqués.
  function handleBecomePromoter() {
    window.scrollTo({ top: 0 });
    if (!user) {
      setCheckoutEvent(null);
      // Sur l'inscription, et non la connexion : quelqu'un qui clique « Devenir promoteur »
      // n'a par définition pas encore de compte. Le type de compte est présélectionné pour la
      // même raison — il vient d'exprimer son intention, la lui redemander serait redondant.
      setAuthIntent("promoter");
      openAuthScreen("register");
      return;
    }
    setActiveTab("profile");
  }

  // « Devenir prestataire » depuis le marché de prestataires : va directement au tableau de
  // bord prestataire, qui affiche le formulaire de demande tant qu'aucune fiche n'existe (cf.
  // VendorDashboard.tsx) — un visiteur sans compte doit d'abord s'inscrire, comme pour
  // handleBecomePromoter, mais sans présélectionner de rôle : devenir prestataire n'est pas
  // réservé aux organisateurs.
  function handleBecomeVendor() {
    window.scrollTo({ top: 0 });
    if (!user) {
      setCheckoutEvent(null);
      openAuthScreen("register");
      return;
    }
    setActiveTab("vendor-dashboard");
  }

  // La bande « Nous rejoindre » n'a de sens que sur les pages de navigation publique, pour
  // quelqu'un qui n'est pas déjà promoteur. Elle est écartée de la page Tarifs, qui se termine
  // déjà par son propre appel à l'action — deux bandes successives se dévalueraient l'une l'autre.
  const showJoinCta =
    !nativeApp &&
    !authModalVisible &&
    (!user || user.role === "client") &&
    ["home", "event", "organizer-profile"].includes(activeTab);

  // Même bande, pour rejoindre le marché de prestataires plutôt que vendre des billets. Un
  // organisateur peut aussi être prestataire (photographe qui organise ses propres soirées,
  // par exemple) : contrairement à showJoinCta, elle ne lui est pas masquée — seul l'admin
  // n'a rien à y faire.
  const showJoinVendorCta =
    !nativeApp &&
    !authModalVisible &&
    (!user || user.role !== "admin") &&
    ["home", "event", "organizer-profile"].includes(activeTab);

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
    setAuthIntent(null);

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

  // Passe systématiquement par le portillon de la salle d'attente. Ce n'est plus un drapeau
  // porté par l'événement : la file s'arme sur l'affluence mesurée à l'instant présent, donc
  // seul le serveur peut trancher. Hors affluence il répond immédiatement "accès autorisé" et
  // le composant enchaîne sur le paiement sans jamais s'afficher.
  function openCheckoutFlow(event: Event) {
    // La salle d'attente exige une session : POST /api/waiting-room/join est en requireAuth,
    // et le composant n'était de toute façon monté que si `user` existe. Un acheteur invité
    // arrivait donc ici après avoir saisi ses coordonnées, et RIEN ne s'ouvrait — le tunnel
    // s'arrêtait net, sans erreur ni explication. Il va désormais droit au paiement ; si la
    // file est réellement armée sur cet événement, c'est /api/checkout qui le lui dira.
    if (user) {
      setWaitingRoomEvent(event);
    } else {
      setCheckoutEvent(event);
    }
  }

  function handleBuyTicketTrigger(event: Event, quantities: Record<string, number> = {}) {
    setPendingQuantities(quantities);
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
    openAuthScreen("login");
  }

  function handleCheckoutSuccess(_tickets: any[]) {
    // Refresh events lists to reflect decremented ticket inventory instantly (force=true
    // pour contourner le cache client, sinon l'inventaire affiché resterait obsolète
    // jusqu'à expiration du TTL).
    fetchEvents(true);
    // La destination est seulement MÉMORISÉE ici. Fermer la modale à cet instant la
    // démontait avant que son écran de confirmation n'ait pu s'afficher : l'acheteur voyait
    // la fenêtre disparaître et se retrouvait sur l'accueil, ce qui donne exactement
    // l'impression que l'achat a échoué — y compris quand les billets ont bien été émis.
    //
    // Les invités n'ont pas d'espace "Mes billets" connecté : les renvoyer vers l'accueil
    // évite une page blanche, leurs QR codes étant envoyés par email. Un organisateur, lui,
    // achète des billets comme tout le monde et dispose bien de cet espace.
    setPostCheckoutTab(user && user.role !== "admin" ? "client-dashboard" : "home");
  }

  // Fermeture de la modale de paiement, qu'un achat ait abouti ou non : la navigation
  // d'après-achat n'a lieu qu'ici, une fois la confirmation réellement vue.
  function handleCheckoutClose() {
    setCheckoutEvent(null);
    setGuestInfo(null);
    if (postCheckoutTab) {
      setActiveTab(postCheckoutTab);
      setPostCheckoutTab(null);
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
      <div className="min-h-screen bg-gray-50" id="session-bootstrap-loader">
        {/* Barre de navigation esquissée puis grille : c'est l'accueil qui s'affiche dans la
            très grande majorité des cas, et le squelette évite l'écran vide du tout premier
            affichage, avant même de savoir si une session existe. */}
        <div className="h-16 w-full border-b border-orange-100 bg-white" />
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-6">
          <EventGridSkeleton count={3} />
        </div>
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
          setActiveTab={navigateToTab}
          onOpenAuth={() => {
            setCheckoutEvent(null);
            setAuthIntent(null);
            openAuthScreen("login");
          }}
          onBecomePromoter={handleBecomePromoter}
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
            initialMode={authScreen}
            initialRole={authIntent === "promoter" ? "organizer" : undefined}
            onModeChange={setAuthScreen}
            onCancel={() => {
              setAuthModalVisible(false);
              setAuthIntent(null);
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
                  <EventGridSkeleton id="global-events-loader" />
                ) : (
                  <LandingPage
                    events={events}
                    onViewEvent={handleViewEvent}
                    userRole={user?.role}
                    onViewOrganizer={handleViewOrganizer}
                  />
                )}
              </>
            )}

            {activeTab === "event" && (
              <Suspense fallback={<ScreenLoader />}>
                <EventPage
                  event={events.find((e) => e.id === viewingEventId) || null}
                  loading={loadingEvents}
                  onBack={() => setActiveTab("home")}
                  onBuyTicket={handleBuyTicketTrigger}
                  onViewOrganizer={handleViewOrganizer}
                />
              </Suspense>
            )}

            {activeTab === "organizer-profile" && viewingOrganizerAlias && (
              <OrganizerProfilePage
                alias={viewingOrganizerAlias}
                onBack={handleBackFromOrganizerProfile}
                onViewEvent={handleViewEvent}
              />
            )}

            {/* Un seul Suspense pour tous les écrans chargés à la demande : un seul est monté
                à la fois, et le repli occupe de toute façon la même zone. */}
            <Suspense fallback={<ScreenLoader />}>
              {activeTab === "vendors" && (
                <VendorsMarketplacePage
                  onViewVendor={handleViewVendor}
                  onBecomeVendor={user?.role === "admin" ? undefined : handleBecomeVendor}
                />
              )}

              {activeTab === "vendor-profile" && viewingVendorAlias && (
                <VendorProfilePage alias={viewingVendorAlias} onBack={handleBackFromVendorProfile} />
              )}

              {activeTab === "vendor-dashboard" && user && (
                <VendorDashboard user={user} />
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

              {/* L'admin a aussi accès au contrôle d'accès : POST /api/verify-ticket l'autorise
                  explicitement (requireRole("organizer", "admin")), mais l'interface le lui
                  refusait — il ne pouvait donc pas dépanner une entrée sur place. */}
              {activeTab === "scanner" && user && (user.role === "organizer" || user.role === "admin") && (
                <QrScannerTab user={user} />
              )}

              {activeTab === "terms" && <TermsPage onBack={() => setActiveTab("home")} />}

              {activeTab === "privacy" && <PrivacyPage onBack={() => setActiveTab("home")} />}

              {activeTab === "pricing" && (
                <PricingPage
                  onBack={() => setActiveTab("home")}
                  onCreateAccount={() => openAuthScreen("register")}
                  onContact={() => setActiveTab("contact")}
                />
              )}

              {activeTab === "contact" && <ContactPage onBack={() => setActiveTab("pricing")} />}

              {activeTab === "profile" && user && (
                <ProfilePage user={user} onLogout={handleLogout} setActiveTab={setActiveTab} />
              )}
            </Suspense>
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
          initialQuantities={pendingQuantities}
          onClose={handleCheckoutClose}
          onSuccess={handleCheckoutSuccess}
          onOpenAuth={() => {
            openAuthScreen("login");
          }}
        />
      )}

      {showJoinCta && <JoinPromoterCta onJoin={handleBecomePromoter} isSignedIn={Boolean(user)} />}
      {showJoinVendorCta && <JoinVendorCta onJoin={handleBecomeVendor} isSignedIn={Boolean(user)} />}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <PwaInstallPrompt />

      {/* Page Footer web (masqué en app native : CGV/Confidentialité/déconnexion vivent déjà
          dans l'onglet Profil de la barre native, un footer "copyright" n'a pas sa place dans
          une app installée). */}
      {!nativeApp && (
        <footer className="mt-auto border-t border-gray-100 bg-white py-6 text-center text-xs text-gray-400 font-semibold uppercase tracking-wider print:hidden">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p>© {new Date().getFullYear()} clicbillet. Tous droits réservés.</p>
            {/* Les séparateurs « • » disparaissent au profit d'un espacement : ces quatre
                liens ne faisaient que 16 px de haut, soit la hauteur du texte, et ils sont
                présents au bas de CHAQUE écran. Les puces les collaient les uns aux autres,
                si bien qu'au doigt on ouvrait les CGV en visant Contact. */}
            <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
              {([
                ["pricing", "Tarifs"],
                ["contact", "Contact"],
                ["terms", "Conditions Générales de Vente"],
                ["privacy", "Confidentialité"],
              ] as const).map(([tab, libelle]) => (
                <button
                  key={tab}
                  onClick={() => navigateToTab(tab)}
                  className="flex min-h-11 items-center rounded-lg px-3 hover:bg-gray-50 hover:text-gray-600 sm:min-h-0 sm:px-2 sm:py-1"
                >
                  {libelle}
                </button>
              ))}
            </div>
          </div>
        </footer>
      )}

      {/* Barre d'onglets native, fixe en bas — uniquement dans le conteneur Capacitor */}
      {nativeApp && (
        <BottomTabBar
          user={user}
          activeTab={activeTab}
          setActiveTab={navigateToTab}
          onFocusSearch={handleFocusSearch}
          onOpenAuth={() => {
            setCheckoutEvent(null);
            openAuthScreen("login");
          }}
        />
      )}
    </div>
  );
}
