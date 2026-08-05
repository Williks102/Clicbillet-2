// Correspondance entre les écrans de l'application et des URL réelles.
//
// L'app est une page unique : toute la navigation repose sur un état `activeTab` dans App.tsx,
// et l'URL restait sur "/" quel que soit l'écran affiché. Conséquence directe : aucun écran
// n'était partageable ni ajoutable aux favoris, le bouton "précédent" du navigateur faisait
// sortir de l'application, et rien n'était indexable.
//
// Ce module ne fait qu'une chose : traduire un chemin en onglet, et réciproquement. Aucune
// dépendance de routage n'est introduite — App.tsx pose lui-même l'URL via l'API History,
// exactement comme le faisait déjà la page publique organisateur (/o/:alias), désormais
// intégrée ici plutôt que traitée à part.

export interface RouteMatch {
  tab: string;
  // Renseigné uniquement pour /o/:alias.
  organizerAlias: string | null;
}

// Chemins en français : ils sont visibles par l'utilisateur et partagés tels quels.
const TAB_BY_PATH: Record<string, string> = {
  "/": "home",
  "/tarifs": "pricing",
  "/contact": "contact",
  "/cgv": "terms",
  "/confidentialite": "privacy",
  "/mes-billets": "client-dashboard",
  "/organisateur": "organizer-dashboard",
  "/supervision": "admin-dashboard",
  "/scanner": "scanner",
  "/profil": "profile",
};

const PATH_BY_TAB: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_BY_PATH).map(([path, tab]) => [tab, path])
);

const ORGANIZER_PATH_REGEX = /^\/o\/([a-z0-9-]+)\/?$/;

// Traduit l'URL courante en écran à afficher. Un chemin inconnu retombe sur l'accueil plutôt
// que sur un écran vide : le serveur renvoie index.html pour tout chemin non résolu
// (cf. vercel.json), donc n'importe quelle URL erronée arrive bien jusqu'ici.
export function matchPath(pathname: string): RouteMatch {
  const organizerMatch = ORGANIZER_PATH_REGEX.exec(pathname);
  if (organizerMatch) {
    return { tab: "organizer-profile", organizerAlias: organizerMatch[1] };
  }

  // Tolère un slash final ("/tarifs/" comme "/tarifs"), fréquent dans un lien recopié à la main.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return { tab: TAB_BY_PATH[normalized] || "home", organizerAlias: null };
}

// Chemin correspondant à un écran. Les onglets sans URL propre (écrans transitoires ouverts
// en modale, par exemple) retombent sur "/" : mieux vaut une URL honnête que l'illusion d'un
// lien qui ne rouvrirait pas le même écran.
export function pathForTab(tab: string, organizerAlias?: string | null): string {
  if (tab === "organizer-profile") {
    return organizerAlias ? `/o/${organizerAlias}` : "/";
  }
  return PATH_BY_TAB[tab] || "/";
}
