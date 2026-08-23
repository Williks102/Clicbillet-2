import { Sparkles, ArrowRight, Camera, MessageCircleMore, Globe } from "lucide-react";
import Reveal from "./Reveal";

interface JoinVendorCtaProps {
  // Mène là où le parcours se poursuit réellement : création de compte pour un visiteur,
  // tableau de bord (formulaire de demande ou fiche déjà publiée) pour un compte déjà connecté.
  // C'est App.tsx qui tranche, seul à connaître l'état de connexion (cf. handleBecomeVendor).
  onJoin: () => void;
  isSignedIn: boolean;
}

const ARGUMENTS = [
  { icon: Globe, title: "Gratuit pour l'instant", text: "Publier une fiche vitrine ne coûte rien : photographe, régie, MC, traiteur..." },
  { icon: MessageCircleMore, title: "Devis reçus par e-mail", text: "Chaque demande de devis vous parvient directement, avec la fiche complète." },
  { icon: Camera, title: "Un portfolio partageable", text: "Vos photos, vos catégories, votre page (clicbillet.ci/p/votre-alias)." },
];

// Bande d'appel à l'action "rejoindre le marché de prestataires", jumelle de
// JoinPromoterCta.tsx (même gabarit visuel), affichée juste après elle en bas des pages
// publiques : deux appels à rejoindre la plateforme, l'un côté organisateur d'événements,
// l'autre côté prestataire de services.
export default function JoinVendorCta({ onJoin, isSignedIn }: JoinVendorCtaProps) {
  return (
    <section className="mx-auto w-full max-w-7xl px-3 pb-10 sm:px-6" id="join-vendor-cta">
      <Reveal className="overflow-hidden rounded-3xl bg-[#1a252f] px-6 py-10 text-white shadow-xl sm:px-12 sm:py-12">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Vous êtes prestataire événementiel ?</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-200">
            Photographe, vidéaste, DJ, régie son ou lumière, MC, traiteur, décorateur... publiez votre fiche sur le
            marché de prestataires ClicBillet et recevez des demandes de devis directement.
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
            id="join-vendor-btn"
            onClick={onJoin}
            className="mx-auto mt-8 flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-black text-orange-700 transition hover:bg-orange-50 active:scale-95"
          >
            <span>{isSignedIn ? "Devenir prestataire" : "Créer mon compte"}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-3 text-[11px] font-semibold text-gray-300">
            Chaque fiche est vérifiée par l'équipe avant sa publication.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
