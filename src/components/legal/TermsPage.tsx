import { FileText, Phone, Mail } from "lucide-react";
import { LegalPage, LegalSection, LegalHighlight, LegalDefinitionBox, LegalContactCard } from "./LegalPage";

export default function TermsPage({ onBack }: { onBack: () => void }) {
  const today = new Date().toLocaleDateString("fr-FR");

  return (
    <LegalPage
      icon={FileText}
      title="Conditions Générales de Vente"
      subtitle="ClicBillet CI - Plateforme de billetterie ivoirienne"
      lastUpdated={today}
      onBack={onBack}
    >
      <LegalSection number={1} title="Présentation">
        <p>
          Les présentes CGV ont pour objet de définir les droits et obligations des parties dans le cadre de la
          vente de tickets d'événements et de services connexes par l'intermédiaire de la plateforme de
          billetterie <strong>CLICBILLET</strong>.
        </p>
        <p>
          Les présentes conditions générales de vente ci-après dénommées <strong>« CGV »</strong> sont conclues
          d'une part par la société <strong>KOULIBALY ABISCHEK FINANCE MULTIBANKING FINANCE</strong> au capital de{" "}
          <strong>1 000 000 FCFA</strong> dont le siège social est situé à{" "}
          <strong>7 AVENUE NORGUES IMMEUBLE BSIC</strong>, immatriculée au registre du commerce et des sociétés
          d'Abidjan sous le numéro <strong>CI-ABJ-2017-B-21203</strong>, éditrice de la plateforme{" "}
          <strong>clicbillet.com</strong>, ci-après dénommée <strong>« CLICBILLET »</strong> et d'autre part, par
          toute personne physique ou morale ci-après dénommée <strong>« le Client »</strong>, souhaitant effectuer
          un achat via le site internet <strong>https://clicbillet.com</strong> et applications mobiles associées
          ci-après dénommées <strong>« la plateforme »</strong>.
        </p>
        <LegalDefinitionBox>
          <h3 className="mb-2 font-bold text-orange-600">Définitions :</h3>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Catalogue :</strong> liste des événements disponibles proposant des tickets sur la plateforme au moment de la consultation</li>
            <li><strong>Code Client :</strong> code unique associé à chaque utilisateur inscrit sur la plateforme</li>
            <li><strong>Promoteur :</strong> personne physique ou morale ayant publié un ou plusieurs événements sur la plateforme</li>
            <li><strong>Articles :</strong> tout bien ou service en vente sur la plateforme à savoir des tickets d'événements et produits connexes</li>
          </ul>
        </LegalDefinitionBox>
      </LegalSection>

      <LegalSection number={2} title="Objet du contrat">
        <p>
          Les présentes CGV ont pour objet de définir les droits et obligations des parties dans le cadre de la
          vente de tickets d'événements et de services connexes par l'intermédiaire de la plateforme de
          billetterie <strong>CLICBILLET</strong>.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Acceptation des CGV">
        <p>
          Toute commande passée par le biais de la plateforme entraîne l'acceptation sans réserve des présentes
          CGV. Ces CGV fonctionnent conjointement avec notre politique de confidentialité et conditions générales
          d'utilisation.
        </p>
      </LegalSection>

      <LegalSection number={4} title="Caractéristiques des articles">
        <p>
          Les tickets en vente sont pour les événements mentionnés dans le catalogue. Cependant, nous pouvons
          également fournir d'autres articles liés aux tickets. Ces tickets sont disponibles à l'achat jusqu'à
          épuisement des stocks.
        </p>
        <p>
          Chaque événement est représenté par une image, une description textuelle, un ensemble de types de
          tickets et de nombreuses autres informations provenant de l'organisateur.
        </p>
        <p>
          Sur la plateforme, vous trouverez presque tous les types d'événements, allant des concerts aux
          festivals et aux événements sportifs et touristiques.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Zone géographique">
        <p>
          La vente de tickets d'événements sur la plateforme n'est pas limitée à une zone géographique, bien que
          ces événements se déroulent généralement en <strong>Côte d'Ivoire</strong>.
        </p>
        <p>
          Les dates des événements et toutes les conditions se référant aux dates sauf indication contraire sont
          dans le fuseau horaire <strong>GMT (heure d'Abidjan)</strong>.
        </p>
      </LegalSection>

      <LegalSection number={6} title="Tarifs">
        <p>
          Les prix indiqués dans le catalogue et sur la page de sélection des tickets sont les prix mentionnés
          par l'organisateur de l'événement. <strong>CLICBILLET ne fixe pas le prix des tickets des événements</strong>,
          chaque organisateur est libre de fixer les prix des tickets et peut les modifier à tout moment.
        </p>
        <p>
          Des <strong>frais de service</strong> (taxes, frais de paiement...etc.), dont le montant est indiqué sur
          la page de paiement, peuvent s'ajouter à ces prix. Le montant TTC payé au moment de l'achat est donc le
          prix des tickets fixé par l'organisateur, majoré éventuellement des frais de service, constituant ainsi
          le prix TTC tenant compte de la TVA applicable à la date de la commande.
        </p>
        <p>
          <strong>CLICBILLET</strong> se réserve le droit de modifier à tout moment le montant des frais de
          service, étant entendu que le montant figurant sur la page de paiement au jour de la commande sera le
          seul applicable au Client.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Commandes">
        <p>
          Afin de passer une commande sur la plateforme, il est recommandé que le Client dispose d'une adresse
          e-mail valide et suive l'un des processus de commande suivants :
        </p>
        <LegalHighlight>
          <h3 className="mb-2 font-bold text-orange-600">Processus d'achat :</h3>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li><strong>Sélectionner</strong> des articles (tickets, sièges et produits connexes)</li>
            <li><strong>Saisir les coordonnées</strong> du Client : e-mail, numéro de téléphone et informations de facturation éventuellement</li>
            <li><strong>Payer</strong> la commande avec l'un des moyens de paiement disponibles</li>
            <li>Pour les deux autres procédures, le Client doit posséder un compte préalablement sur la plateforme</li>
          </ol>
        </LegalHighlight>
        <p>
          Après validation du paiement, le Client reçoit un email de confirmation de commande. Le Client peut à
          tout moment au cours du processus de commande consulter le détail de sa commande ainsi que son prix
          total et corriger d'éventuelles erreurs, avant de confirmer pour exprimer son acceptation.
        </p>
        <p>
          Toute commande emporte contractuellement l'acceptation sans réserve de l'intégralité des conditions
          générales applicables au moment de l'achat telles que les conditions générales de vente et la politique
          de confidentialité disponibles sur la plateforme.
        </p>
        <p>
          En tant que <strong>mandataire de l'organisateur</strong> de l'événement dans la vente de ses tickets,{" "}
          <strong>CLICBILLET</strong> se réserve la propriété des articles jusqu'au règlement complet de la
          commande, c'est-à-dire jusqu'à l'encaissement du prix TTC de la commande.
        </p>
        <p>
          <strong>CLICBILLET</strong> se réserve le droit d'annuler ou de refuser toute commande d'un Client avec
          lequel existerait un quelconque litige, notamment relatif au paiement d'une commande antérieure.
        </p>
        <p>
          <strong>CLICBILLET</strong> s'engage à honorer les commandes reçues sur la plateforme seulement dans la
          limite des stocks disponibles.
        </p>
      </LegalSection>

      <LegalSection number={8} title="Modalités de paiement">
        <p>Le règlement des achats s'effectue par l'un des moyens suivants, au choix du Client :</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Par Mobile Money</strong></li>
          <li><strong>Par carte bancaire</strong></li>
          <li><strong>Par code coupon</strong></li>
        </ul>
        <p>
          Dès confirmation de l'achat, <strong>CLICBILLET</strong> se charge d'envoyer les tickets par e-mail au
          Client. Le délai de traitement de l'envoi de l'email est de <strong>5 minutes</strong> après validation
          du paiement. Les délais de réception de l'e-mail ne dépendent pas de <strong>CLICBILLET</strong>, mais du
          serveur de messagerie du Client.
        </p>
        <p>
          <strong>CLICBILLET</strong> s'engage à livrer les commandes passées par le Client dans les délais
          impartis. En cas de non livraison des articles plus de <strong>deux (2) heures</strong> après la
          commande, le Client pourra procéder à la résolution de la vente et demander le remboursement, sauf cas
          de force majeure constaté.
        </p>
        <p>
          Le Client dispose d'un délai de <strong>sept (7) jours</strong> à compter de la date d'achat de la
          commande pour signaler la non réception. Passé ce délai, toute demande de résolution de la vente ne
          pourra être acceptée. Le Client devra adresser un courrier de réclamation à l'adresse suivante :{" "}
          <a href="mailto:contacts@clicbillet.com" className="font-semibold text-orange-600 hover:underline">
            contacts@clicbillet.com
          </a>.
        </p>
        <p>
          Le Client est tenu de vérifier le bon état des articles livrés au moment de la livraison. Toute anomalie
          constatée (articles manquants, informations erronées, etc.) devra être signalée à{" "}
          <strong>CLICBILLET</strong>, par tous moyens suivant la livraison, notamment en écrivant à{" "}
          <a href="mailto:contacts@clicbillet.com" className="font-semibold text-orange-600 hover:underline">
            contacts@clicbillet.com
          </a>.
        </p>
        <p>
          Avec les mêmes délais de livraison que l'envoi par email, les tickets d'événements réservés sont
          également disponibles, via la plateforme avec le compte associé à l'email qui a été utilisé lors de la
          commande.
        </p>
      </LegalSection>

      <LegalSection number={9} title="Utilisation et validité des tickets">
        <p>Tout ticket commandé et acheté sur la plateforme est soumis aux conditions suivantes :</p>
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">Validité du ticket</h3>
          <p>
            Un ticket n'est valable que pour l'événement qu'il concerne, à la date, à l'heure et dans les
            conditions indiquées sur le ticket. Il est disponible à tout moment dans le compte{" "}
            <strong>CLICBILLET</strong> associé à l'email utilisé lors de la réservation jusqu'à la fin de
            l'événement.
          </p>
        </div>
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">Revente de ticket</h3>
          <p>
            Sauf accord préalable et écrit de <strong>CLICBILLET</strong>, il est formellement et expressément
            interdit d'offrir à la vente, vendre, revendre, échanger ou transférer un ticket, d'une quelconque
            manière et à quelque fin que ce soit (en ce compris promotionnelles ou dans le cadre d'une activité
            commerciale). Il est ainsi notamment interdit de revendre, de permettre la revente d'un ticket sur des
            plateformes commerciales ou par le biais d'intermédiaires ou de proposer un ticket sur lesdites
            plateformes, sans l'accord préalable et écrit de <strong>CLICBILLET</strong>. La seule alternative
            envisageable est le transfert de ticket entre utilisateurs <strong>CLICBILLET</strong> en utilisant la
            plateforme.
          </p>
        </div>
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">Reproduction de ticket</h3>
          <p>
            Toute quelconque falsification, d'une quelconque manière et à quelque fin que ce soit, est
            formellement et expressément interdite, sous peine d'éventuelles poursuites judiciaires.
          </p>
        </div>
        <p>
          Sauf stipulation expresse contraire de <strong>CLICBILLET</strong>, l'utilisation d'un ticket, quelle
          que soit sa forme, est unique, pour une seule entrée et pour un seul événement.
        </p>
        <p>
          L'organisateur peut refuser l'accès au lieu de l'événement s'il a des doutes sur l'origine ou la
          qualité du ticket qui lui est présenté. Compte tenu de la difficulté de vérifier avec certitude
          l'identité de l'acheteur, en cas de vérification obligatoire, seul le porteur du ticket original
          présenté directement sur la plateforme (dans l'application mobile par exemple) sera admis.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Contrôle des tickets">
        <p>
          <strong>CLICBILLET</strong> met à la disposition de l'organisateur de l'événement un système de
          validation, lecture du code QR des tickets. Sous la responsabilité de l'organisateur, ce système est le
          seul autorisé pour le contrôle des tickets.
        </p>
        <p>
          Le jour de l'événement, le Client ou participant à l'événement doit présenter le <strong>QR code</strong>{" "}
          du ticket valide aux personnes en charge du contrôle des tickets. Le QR code et les informations du
          ticket doivent être suffisamment éclairés et facilement lisibles. Le QR code permet l'identification du
          participant et le détail du ticket. L'organisateur pourra remettre éventuellement au Client, après
          contrôle, un ticket standard avec deux souches ou un bracelet lui permettant d'assister à l'événement.
        </p>
        <p>
          Chaque ticket ne peut être présenté qu'<strong>une seule fois</strong> au point de contrôle. Si un
          participant souhaite retourner au point de contrôle (après avoir quitté la salle par exemple), il est
          impératif de contacter les contrôleurs au préalable.
        </p>
      </LegalSection>

      <LegalSection number={11} title="Contrôle de l'identité">
        <p>
          L'organisateur et son équipe de contrôleurs se réservent le droit de contrôler l'identité du Client à
          l'entrée du lieu où se déroule l'événement. Le Client doit donc être muni d'une{" "}
          <strong>pièce d'identité officielle</strong>, en cours de validité et avec photo si nécessaire : carte
          d'identité, passeport, permis de conduire, titre de séjour ou tout autre document accepté par
          l'organisateur et les contrôleurs.
        </p>
      </LegalSection>

      <LegalSection number={12} title="Annulation et remboursements">
        <p>
          Tout ticket acheté sur la plateforme n'est annulable que <strong>30 JOURS</strong> avant la date de
          début de l'événement.
        </p>
        <p>Lorsque le Client annule sa réservation d'un ticket, il bénéficie d'un remboursement.</p>
        <p>
          Si un événement a été <strong>annulé par l'organisateur</strong> de l'événement, tous les participants
          seront remboursés.
        </p>
        <LegalHighlight>
          <strong>Important :</strong> En cas de remboursement d'un ticket, quelle que soit la raison, le montant
          remboursé sera partiel et équivaudra à <strong>90%</strong> du prix du ticket. Le remboursement se fait
          par le biais de <strong>code coupon</strong>, utilisable uniquement sur la plateforme jusqu'à épuisement
          de son montant.
        </LegalHighlight>
      </LegalSection>

      <LegalSection number={13} title="Responsabilité">
        <p>
          <strong>CLICBILLET</strong> est responsable à l'égard des présentes CGV. Conformément à nos conditions
          générales d'utilisation, <strong>CLICBILLET</strong> décline toute responsabilité en cas
          d'indisponibilité ou dysfonctionnement du service résultant d'un cas de force majeure.
        </p>
        <p>
          <strong>CLICBILLET</strong> ne pourra être tenu responsable des incidents pouvant survenir lors de la
          commande. De même, <strong>CLICBILLET</strong> n'est pas responsable en cas de perte, de vol ou
          d'utilisation illicite d'un ticket.
        </p>
        <p><strong>CLICBILLET</strong> n'est pas responsable des questions de santé et de sécurité des événements du catalogue.</p>
        <p>
          <strong>CLICBILLET</strong> n'est pas responsable du déroulement de l'événement (modification de
          contenu, changement de distribution artistique ou sportive, changement d'horaires, etc.) ou de son
          annulation.
        </p>
        <p>Chaque organisateur fixe les règles propres à l'organisation de l'événement. Ce règlement est communiqué par l'organisateur au Client.</p>
        <p>Toute commande du Client implique son adhésion au règlement de l'organisateur, sous peine de voir sa responsabilité engagée.</p>
      </LegalSection>

      <LegalSection number={14} title="Service Client">
        <LegalContactCard>
          <h3 className="mb-3 flex items-center justify-center gap-2 font-bold">Besoin d'aide ?</h3>
          <p className="mb-3 text-sm text-orange-50">
            Pour toute information, vous pouvez contacter le service Client de <strong>CLICBILLET</strong> :
          </p>
          <p className="flex items-center justify-center gap-2 text-sm">
            <Phone className="h-4 w-4" />
            <a href="tel:+22507024902" className="underline">+225 07 02 49 02 77</a>
            <span className="text-orange-100">(prix d'un appel local)</span>
          </p>
          <p className="mt-1.5 flex items-center justify-center gap-2 text-sm">
            <Mail className="h-4 w-4" />
            <a href="mailto:contact@clicbillet.com" className="underline">contact@clicbillet.com</a>
          </p>
        </LegalContactCard>
      </LegalSection>

      <LegalSection number={15} title="Droit applicable et litiges">
        <p>
          Les ventes de tickets effectuées sur la plateforme sont soumises à la <strong>loi ivoirienne</strong>.
          En cas de litige, les <strong>tribunaux ivoiriens</strong> seront seuls compétents.
        </p>
      </LegalSection>

      <p className="border-t border-gray-100 pt-6 text-center text-xs font-semibold text-gray-400">
        Ces conditions générales de vente sont effectives à compter du {today}
      </p>
    </LegalPage>
  );
}
