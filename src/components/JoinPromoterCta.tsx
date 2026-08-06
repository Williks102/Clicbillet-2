import { Store, ArrowRight, Wallet, QrCode, LineChart } from "lucide-react";
import Reveal from "./Reveal";

interface JoinPromoterCtaProps {
  // Mène là où le parcours se poursuit réellement : création de compte pour un visiteur,
  // formulaire de demande pour un acheteur déjà inscrit. C'est App.tsx qui tranche, seul à
  // connaître l'état de connexion.
  onJoin: () => void;
  // Un visiteur n'a pas encore de compte : le libellé doit dire ce qui va se passer au clic,
  // sinon le bouton promet une bascule immédiate qui n'arrivera pas.
  isSignedIn: boolean;
}

const ARGUMENTS = [
  { icon: Wallet, title: "6 % et rien d'autre", text: "Publier est gratuit. La commission ne s'applique qu'aux billets réellement vendus." },
  { icon: QrCode, title: "Contrôle à l'entrée", text: "Scanner de QR codes intégré : plus rapide et plus fiable qu'une liste papier." },
  { icon: LineChart, title: "Recettes en direct", text: "Ventes, entrées et revenus suivis en temps réel, retrait à la demande." },
];

// Bande d'appel à l'action affichée en bas des pages publiques, juste avant le pied de page.
// Volontairement absente de la page Tarifs (qui se termine déjà par son propre appel à l'action)
// et des espaces connectés d'un organisateur ou d'un administrateur, qui n'ont rien à rejoindre.
export default function JoinPromoterCta({ onJoin, isSignedIn }: JoinPromoterCtaProps) {
  return (
    <section className="mx-auto w-full max-w-7xl px-3 pb-10 sm:px-6" id="join-promoter-cta">
      {/* #1a252f : la teinte du pied de page de l'ancienne plateforme (dépôt billeteries,
          resources/views/layouts/app.blade.php), reprise à l'identique pour que les deux sites
          se répondent. Le texte blanc y atteint 15,6:1, très au-delà du minimum de 4,5:1.
          L'orange n'est pas perdu pour autant — il se concentre sur le bouton, seul élément à
          cliquer, qui ressort d'autant mieux sur un fond sombre et neutre. */}
      <Reveal className="overflow-hidden rounded-3xl bg-[#1a252f] px-6 py-10 text-white shadow-xl sm:px-12 sm:py-12">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
            <Store className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Nous rejoindre</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-200">
            Vous organisez des concerts, des soirées, des matchs ou des spectacles ? Vendez vos billets sur
            ClicBillet et suivez vos recettes depuis votre téléphone.
          </p>

          <div className="mt-8 grid gap-4 text-left sm:grid-cols-3">
            {ARGUMENTS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl bg-white/10 p-4">
                <Icon className="h-5 w-5" />
                <h3 className="mt-2.5 text-sm font-black">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-200">{text}</p>
              </div>
            ))}
          </div>

          <button
            id="join-promoter-btn"
            onClick={onJoin}
            // orange-700 et non orange-600 : sur fond blanc, le 600 ne donne que 3,6:1, sous le
            // minimum de 4,5:1 pour un texte de cette taille. Le 700 monte à 5,2:1 pour une
            // différence de teinte à peine perceptible.
            className="mx-auto mt-8 flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-black text-orange-700 transition hover:bg-orange-50 active:scale-95"
          >
            <span>{isSignedIn ? "Devenir promoteur" : "Créer mon compte promoteur"}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
          {/* « Chaque événement » et non « chaque demande » : les deux parcours ne passent pas
              par la même vérification — un visiteur crée directement son compte promoteur, un
              acheteur déjà inscrit dépose une demande soumise à l'administrateur. Ce qui est
              vrai des deux côtés, c'est que l'événement naît en attente d'approbation
              (cf. status 'pending' à la création, server/routes/events.ts). */}
          <p className="mt-3 text-[11px] font-semibold text-gray-300">
            Chaque événement est vérifié par l'équipe avant sa mise en vente.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
