import { useState } from "react";
import {
  Tag,
  Calculator,
  Store,
  Scissors,
  Settings,
  Headphones,
  Route,
  Smartphone,
  CreditCard,
  Gift,
  UserPlus,
  Phone,
  HelpCircle,
  ChevronDown,
  ArrowLeft
} from "lucide-react";
import Reveal from "./Reveal";

const COMMISSION_RATE = 0.06;

const FEATURES = [
  {
    icon: Store,
    title: "Place de marché",
    text: "En plus d'une disponibilité 24h/24 et 7j/7, nous étendons les moyens de paiement pour vos participants grâce à notre réseau étendu. Vous ne trouverez pas un si grand marché pour vendre vos tickets en Côte d'Ivoire."
  },
  {
    icon: Scissors,
    title: "Suppression des coûts annexes",
    text: "Infographie, impression, collecte des recettes, contrôle des tickets... Oubliez ces tâches fastidieuses et concentrez-vous sur le cœur de votre événement. Notre plateforme est une solution clé en main."
  },
  {
    icon: Settings,
    title: "Simplicité et flexibilité",
    text: "ClicBillet est facile à utiliser avec uniquement des fonctionnalités utiles. Plusieurs types de tickets possibles, prix modifiables à tout moment, outils de gestion avancés et bien plus."
  },
  {
    icon: Headphones,
    title: "Accompagnement",
    text: "De la vente des tickets à la fin de l'événement, nous sommes à vos côtés. Notre service client est disponible et prêt à répondre à vos questions."
  }
];

const STEPS = [
  {
    title: "Renseignez les informations",
    text: "Titre, description, images, date, lieu, types de billets... Indiquez si l'événement est ouvert à tous ou réservé à vos invités."
  },
  {
    title: "Publiez votre événement",
    text: "Une fois publié, vos participants peuvent acheter des places où qu'ils soient, à tout moment. Suivez en direct la liste de vos billets vendus et vos recettes."
  },
  {
    title: "Organisez l'événement",
    text: "Le jour J, utilisez notre scanner QR code pour valider les billets à l'entrée — plus rapide et plus fiable qu'un contrôle papier classique."
  },
  {
    title: "Recevez vos revenus",
    text: "Vos revenus sont disponibles à la demande depuis votre tableau de bord organisateur. Plus besoin d'attendre — retirez vos gains quand vous le souhaitez."
  }
];

const PAYMENT_METHODS = [
  { icon: Smartphone, title: "Mobile Money", text: "Orange Money, MTN Money, Moov Money", note: "Paiement instantané" },
  { icon: CreditCard, title: "Carte bancaire", text: "Visa, Mastercard", note: "Paiement sécurisé SSL" },
  { icon: Gift, title: "Code coupon", text: "Bons d'achat et promotions", note: "Pour vos invités VIP" }
];

const FAQ = [
  {
    q: "Comment récupérer mes revenus ?",
    a: "Vos revenus sont disponibles à la demande depuis votre tableau de bord organisateur. Plus besoin d'attendre une date fixe — retirez vos gains quand vous le souhaitez (Mobile Money ou virement bancaire)."
  },
  {
    q: "Y a-t-il des frais cachés ?",
    a: "Non, transparence totale : seuls 6% de commission sont déduits du prix du billet. Aucun frais technique supplémentaire, aucune surprise."
  },
  {
    q: "Que se passe-t-il si personne n'achète de billets ?",
    a: "Aucun frais ! Si aucun billet n'est vendu, vous ne payez rien. Notre commission ne s'applique que sur les ventes effectives."
  },
  {
    q: "Puis-je modifier mes prix après publication ?",
    a: "Oui, totalement. Vous pouvez ajuster vos prix à tout moment selon l'évolution de vos ventes."
  }
];

export default function PricingPage({ onBack, onCreateAccount, onContact }: { onBack: () => void; onCreateAccount: () => void; onContact: () => void }) {
  const [ticketPrice, setTicketPrice] = useState("5000");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const price = Number(ticketPrice) || 0;
  const organizerEarnings = Math.round(price * (1 - COMMISSION_RATE));

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={onBack}
        className="mb-6 flex items-center space-x-1.5 text-xs font-bold text-gray-500 transition-colors hover:text-orange-600"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Retour à l'accueil</span>
      </button>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 px-6 py-14 text-center text-white shadow-xl sm:px-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white/25 via-transparent to-transparent opacity-60" />
        <div className="relative z-10">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
            <Tag className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Tarifs</h1>
          <p className="mt-2 text-sm text-orange-50">Pour les organisateurs d'événements</p>
          <p className="mx-auto mt-4 max-w-lg text-sm text-orange-50">
            <strong>Publier un événement sur ClicBillet est GRATUIT.</strong> Les frais ne s'appliquent qu'aux billets
            payés par les participants.
          </p>
        </div>
      </section>

      {/* Commission highlight. Le hero au-dessus n'est volontairement pas animé : il est déjà
          dans l'écran au chargement, l'y faire apparaître retarderait la première lecture. */}
      <Reveal className="relative z-10 -mt-8 mx-auto max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-lg">
        <div className="text-6xl font-black text-orange-600">
          {Math.round(COMMISSION_RATE * 100)}
          <span className="text-3xl">%</span>
        </div>
        <p className="mt-1 text-lg font-bold text-gray-900">Et puis c'est tout !</p>
        <p className="mt-2 text-sm text-gray-500">Vendez les billets de votre événement sur ClicBillet</p>
      </Reveal>

      <Reveal as="p" delay={80} className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-gray-600">
        Avec notre plateforme, les frais ne sont que de <strong className="text-gray-900">{Math.round(COMMISSION_RATE * 100)}%</strong> du
        prix du billet. Profitez d'une place de marché 24/7 et de milliers de participants potentiels — vous ne
        trouverez pas meilleur service pour vendre vos billets en Côte d'Ivoire.
      </Reveal>

      {/* Calculateur */}
      <Reveal as="section" className="mt-10 rounded-3xl bg-gray-50 p-6 sm:p-10">
        <h2 className="text-center text-xl font-black text-gray-900">Comprenez nos frais en un coup d'œil</h2>
        <p className="mx-auto mt-2 max-w-md text-center text-xs text-gray-500">
          Entrez le prix d'un billet et laissez-nous calculer le reste.
        </p>

        <div className="mx-auto mt-6 max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
          <h3 className="flex items-center justify-center gap-2 text-sm font-black text-gray-900">
            <Calculator className="h-4 w-4 text-orange-600" />
            <span>Calculez vos revenus</span>
          </h3>

          <div className="mt-5">
            <label className="mb-2 block text-center text-xs font-bold text-gray-600">Prix d'un billet (XOF)</label>
            <input
              id="pricing-calculator-input"
              type="number"
              min={0}
              step={500}
              value={ticketPrice}
              onChange={(e) => setTicketPrice(e.target.value)}
              className="w-full rounded-xl border-2 border-gray-100 px-4 py-3 text-center text-lg font-bold outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border-2 border-sky-100 bg-sky-50 p-4 text-center">
              <div id="pricing-calculator-participant" className="text-xl font-black text-sky-700">
                {price.toLocaleString("fr-FR")} F
              </div>
              <p className="mt-1 text-[11px] font-semibold text-gray-600">Le participant paie</p>
            </div>
            <div className="rounded-xl border-2 border-emerald-100 bg-emerald-50 p-4 text-center">
              <div id="pricing-calculator-organizer" className="text-xl font-black text-emerald-700">
                {organizerEarnings.toLocaleString("fr-FR")} F
              </div>
              <p className="mt-1 text-[11px] font-semibold text-gray-600">Vous recevez</p>
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-gray-400">
            Commission ClicBillet : {Math.round(COMMISSION_RATE * 100)}% du prix du billet, aucun frais technique
            supplémentaire.
          </p>
        </div>
      </Reveal>

      {/* Avantages. Les cartes apparaissent en cascade : ici l'apparition porte sur chaque carte
          et non sur la section entière, sinon deux animations s'imbriqueraient. La carte reste
          dans un conteneur pour que son effet de survol (translation) ne soit pas ralenti par
          la durée de l'apparition, et h-full préserve la hauteur égale des cartes de la grille. */}
      <section className="mt-14">
        <Reveal as="h2" className="text-center text-xl font-black text-gray-900">Pourquoi organiser votre événement sur ClicBillet ?</Reveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 120}>
              <div className="h-full rounded-2xl border border-gray-100 bg-white p-6 shadow-xs transition-all hover:-translate-y-1 hover:shadow-md">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-600 to-orange-500 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-sm font-black text-gray-900">{title}</h3>
                <p className="text-xs leading-relaxed text-gray-500">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Workflow */}
      <Reveal as="section" className="mt-14 rounded-3xl border border-gray-100 bg-white p-6 shadow-xs sm:p-10">
        <h2 className="flex items-center justify-center gap-2 text-center text-xl font-black text-gray-900">
          <Route className="h-5 w-5 text-orange-600" />
          <span>Comment ça marche en 4 étapes</span>
        </h2>
        <div className="mt-8 space-y-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex items-start gap-4 rounded-2xl bg-gray-50 p-5 transition-colors hover:bg-orange-50/40">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-600 to-orange-500 text-lg font-black text-white shadow-md shadow-orange-100">
                {i + 1}
              </div>
              <div>
                <h4 className="text-sm font-black text-orange-600">{step.title}</h4>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{step.text}</p>
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Moyens de paiement */}
      <section className="mt-14">
        <Reveal as="h2" className="text-center text-xl font-black text-gray-900">Moyens de paiement acceptés</Reveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {PAYMENT_METHODS.map(({ icon: Icon, title, text, note }, i) => (
            <Reveal key={title} delay={i * 120}>
              <div className="h-full rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-xs">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-600 to-orange-500 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-black text-gray-900">{title}</h3>
                <p className="mt-1 text-xs text-gray-500">{text}</p>
                <p className="mt-1 text-[10px] font-semibold text-gray-400">{note}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <Reveal as="section" className="mt-14">
        <h2 className="text-center text-xl font-black text-gray-900">Questions fréquentes</h2>
        <div className="mx-auto mt-8 max-w-2xl space-y-3">
          {FAQ.map((item, i) => (
            <div key={item.q} className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left text-sm font-bold text-gray-900"
              >
                <span className="flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 shrink-0 text-orange-600" />
                  {item.q}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${openFaq === i ? "rotate-180" : ""}`} />
              </button>
              {openFaq === i && (
                <p className="px-4 pb-4 text-xs leading-relaxed text-gray-500">{item.a}</p>
              )}
            </div>
          ))}
        </div>
      </Reveal>

      {/* CTA final */}
      <Reveal as="section" className="my-14 rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 p-8 text-center text-white shadow-xl sm:p-12">
        <h3 className="text-2xl font-black">Prêt à créer votre premier événement ?</h3>
        <p className="mx-auto mt-3 max-w-md text-sm text-orange-50">
          Rejoignez des centaines d'organisateurs qui nous font confiance en Côte d'Ivoire
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onCreateAccount}
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-black text-orange-600 transition hover:bg-orange-50"
          >
            <UserPlus className="h-4 w-4" />
            <span>Créer un compte gratuit</span>
          </button>
          <button
            onClick={onContact}
            className="flex items-center gap-2 rounded-xl border border-white/40 px-6 py-3 text-sm font-black text-white transition hover:bg-white/10"
          >
            <Phone className="h-4 w-4" />
            <span>Parler à un conseiller</span>
          </button>
        </div>
      </Reveal>
    </div>
  );
}
