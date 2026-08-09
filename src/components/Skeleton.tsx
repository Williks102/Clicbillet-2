// Écrans d'attente en forme de squelette, à la place des disques qui tournent.
//
// Un disque qui tourne ne dit rien de ce qui arrive : il occupe l'écran sans l'occuper, et
// l'attente paraît plus longue qu'elle ne l'est parce que rien ne prépare l'œil. Un squelette
// dessine la mise en page à venir — l'utilisateur voit où seront les affiches, les titres, les
// prix, et la bascule vers le contenu réel ne déplace rien.
//
// Deux règles suivies partout ici :
//   - la forme doit correspondre à ce qui va s'afficher. Un squelette générique qui ne
//     ressemble pas au résultat produit un saut à l'arrivée, pire que pas de squelette du tout ;
//   - l'attente doit rester annoncée aux lecteurs d'écran. Le disque portait cette information
//     implicitement ; des blocs gris ne disent rien, d'où le role="status" et le texte masqué
//     visuellement mais lu à voix haute.
//
// L'animation est désactivée quand le système demande moins de mouvement, comme pour les
// apparitions au défilement (cf. Reveal.tsx).

interface BlockProps {
  className?: string;
}

// Brique de base. Le fond gris clair est volontairement discret : un squelette trop contrasté
// attire l'œil sur du vide.
export function SkeletonBlock({ className = "" }: BlockProps) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-gray-200/80 motion-reduce:animate-none ${className}`} />;
}

// Enveloppe commune : annonce le chargement à l'assistance technique, une seule fois par écran.
function SkeletonRegion({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

// Reprend la structure d'EventCard : affiche, catégorie, titre, trois lignes d'informations,
// prix, pastilles de disponibilité, bouton.
export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xs">
      <SkeletonBlock className="h-48 w-full rounded-none" />
      <div className="space-y-3 p-5">
        <SkeletonBlock className="h-4 w-20 rounded-full" />
        <SkeletonBlock className="h-5 w-4/5" />
        <SkeletonBlock className="h-3 w-1/2" />
        <div className="space-y-2 pt-1">
          <SkeletonBlock className="h-3 w-3/5" />
          <SkeletonBlock className="h-3 w-2/5" />
          <SkeletonBlock className="h-3 w-3/4" />
        </div>
        <SkeletonBlock className="h-5 w-1/3" />
        <div className="flex gap-1.5">
          <SkeletonBlock className="h-6 w-24 rounded-lg" />
          <SkeletonBlock className="h-6 w-20 rounded-lg" />
        </div>
        <SkeletonBlock className="h-11 w-full rounded-full" />
      </div>
    </div>
  );
}

// Accueil : barre de recherche, catégories et grille d'affiches, aux mêmes dimensions que
// LandingPage pour que rien ne bouge à l'arrivée des données.
export function EventGridSkeleton({ count = 6, withFilters = true, id }: { count?: number; withFilters?: boolean; id?: string }) {
  return (
    <SkeletonRegion label="Chargement des événements en cours" id={id}>
      <div className="space-y-6 py-6">
        {withFilters && (
          <>
            <SkeletonBlock className="h-12 w-full rounded-2xl" />
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-24 w-24 shrink-0 rounded-2xl" />
              ))}
            </div>
          </>
        )}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: count }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

// Page d'un événement : bandeau, titre, deux tuiles d'information, description, sélecteur de
// tarifs. Le bandeau occupe la même hauteur que l'affiche réelle.
export function EventPageSkeleton() {
  return (
    <SkeletonRegion label="Chargement de l'événement en cours" id="event-page-loader">
      <div className="mx-auto max-w-3xl">
        <SkeletonBlock className="h-4 w-40" />
        <div className="mt-4 overflow-hidden rounded-3xl border border-gray-100 bg-white">
          <SkeletonBlock className="h-64 w-full rounded-none" />
          <div className="space-y-4 p-6">
            <SkeletonBlock className="h-5 w-24 rounded-full" />
            <SkeletonBlock className="h-8 w-3/4" />
            <SkeletonBlock className="h-4 w-1/3" />
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <SkeletonBlock className="h-20 rounded-2xl" />
              <SkeletonBlock className="h-20 rounded-2xl" />
            </div>
            <div className="space-y-2 pt-2">
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-5/6" />
            </div>
            <div className="space-y-3 pt-4">
              <SkeletonBlock className="h-5 w-48" />
              <SkeletonBlock className="h-16 w-full rounded-2xl" />
              <SkeletonBlock className="h-16 w-full rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

// Squelette générique d'écran interne (tableaux de bord, pages légales, profil) : en-tête,
// rangée d'indicateurs, puis blocs de contenu. Ces écrans n'ont pas tous la même forme, mais
// tous commencent par un titre suivi de cartes — c'est ce que le squelette annonce.
export function PageSkeleton({ id = "screen-loader", label = "Chargement de la page en cours" }: { id?: string; label?: string }) {
  return (
    <SkeletonRegion label={label} id={id}>
      <div className="space-y-6 py-6">
        <div className="space-y-3">
          <SkeletonBlock className="h-7 w-2/5" />
          <SkeletonBlock className="h-3 w-1/4" />
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <SkeletonBlock className="h-64 w-full rounded-2xl" />
      </div>
    </SkeletonRegion>
  );
}

// Liste de billets de l'espace client : chaque ligne reprend la hauteur d'une carte de billet.
export function TicketListSkeleton({ count = 3, id }: { count?: number; id?: string }) {
  return (
    <SkeletonRegion label="Chargement de vos billets en cours" id={id}>
      <div className="space-y-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4">
            <SkeletonBlock className="h-16 w-16 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-3/5" />
              <SkeletonBlock className="h-3 w-2/5" />
              <SkeletonBlock className="h-3 w-1/3" />
            </div>
            <SkeletonBlock className="h-8 w-20 rounded-lg" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
