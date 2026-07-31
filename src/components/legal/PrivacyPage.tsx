import { ShieldCheck, Mail, Phone, MapPin } from "lucide-react";
import { LegalPage, LegalSection, LegalHighlight } from "./LegalPage";

export default function PrivacyPage({ onBack }: { onBack: () => void }) {
  const today = new Date().toLocaleDateString("fr-FR");

  return (
    <LegalPage
      icon={ShieldCheck}
      title="Politique de confidentialité"
      subtitle="ClicBillet CI - Protection de vos données personnelles"
      lastUpdated={today}
      onBack={onBack}
    >
      <LegalSection title="Le but de cette politique de confidentialité">
        <p>
          Cette politique de confidentialité s'applique à toutes les données personnelles traitées par{" "}
          <strong>ClicBillet CI</strong> en tant que responsable de traitement conformément au droit ivoirien,
          notamment à la loi n°2013-450 du 19 juin 2013 relative à la protection des données personnelles.
        </p>
        <p>
          Les termes « ClicBillet », « nous » ou « nos/notre » utilisés dans cette politique de confidentialité
          font référence à <strong>ClicBillet CI</strong>. Le terme « plateforme » fait référence au site
          internet <strong>www.clicbillet.com</strong> et aux applications mobiles version Android et iOS
          associées. Lorsque nous utilisons les termes « vous » ou « vos/votre », cela inclut les clients
          potentiels et clients de ClicBillet, visiteurs ou utilisateurs de la plateforme, lors de la
          consultation ou de l'achat de services ou produits proposés par ClicBillet.
        </p>
        <p>
          La présente politique de confidentialité a pour objet d'informer les utilisateurs de notre plateforme
          des données personnelles que nous collectons et des informations suivantes, le cas échéant :
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Les données personnelles que nous collectons</li>
          <li>L'utilisation des données recueillies</li>
          <li>Qui a accès aux données recueillies</li>
          <li>Les droits des utilisateurs de la plateforme</li>
          <li>La politique de cookies de la plateforme</li>
        </ol>
        <p>Cette politique de confidentialité fonctionne conjointement avec nos conditions générales de vente et conditions générales d'utilisation.</p>
      </LegalSection>

      <LegalSection title="Consentement">
        <p>Les utilisateurs conviennent qu'en utilisant notre plateforme, ils consentent à :</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>les conditions énoncées dans la présente politique de confidentialité et</li>
          <li>la collecte, l'utilisation et la conservation des données énumérées dans cette politique.</li>
        </ol>
        <LegalHighlight>
          <strong>Important :</strong> En utilisant notre plateforme, vous consentez aux conditions de cette
          politique et à la collecte de données énumérées.
        </LegalHighlight>
      </LegalSection>

      <LegalSection number={1} title="Données personnelles que nous collectons">
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">1.1 Données collectées automatiquement</h3>
          <p className="mb-2">Lorsque vous visitez et utilisez notre plateforme, nous pouvons collecter et stocker automatiquement les informations suivantes :</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Adresse IP</li>
            <li>Lieu (localisation approximative)</li>
            <li>Détails matériels et logiciels (navigateur, système d'exploitation)</li>
            <li>Liens sur lesquels vous cliquez lorsque vous utilisez la plateforme</li>
            <li>Contenus que vous consultez sur notre plateforme</li>
          </ul>
        </div>
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">1.2 Données collectées de façon non automatique</h3>
          <p className="mb-2">Nous pouvons également collecter les données suivantes lorsque vous exécutez certaines fonctions sur notre plateforme :</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Prénom et nom</li>
            <li>Date de naissance</li>
            <li>Email</li>
            <li>Numéro de téléphone</li>
            <li>Adresse de domicile</li>
            <li>Documents d'identité personnelle et impersonnelle</li>
            <li>Informations de paiement</li>
            <li>Données de remplissage automatique</li>
          </ul>
        </div>
        <p><strong>Ces données peuvent être collectées selon les méthodes suivantes :</strong> enregistrement du compte, formulaires, achat de billets, création d'événements.</p>
        <p>
          Veuillez noter que nous ne collectons que des données qui nous aident à atteindre les objectifs
          définis dans cette politique de confidentialité. Nous ne collecterons pas de données supplémentaires
          sans vous en informer au préalable.
        </p>
      </LegalSection>

      <LegalSection number={2} title="Comment utilisons-nous les données personnelles ?">
        <p>
          Les données personnelles collectées sur notre plateforme ne seront utilisées que pour les finalités
          précisées dans la présente politique ou indiquées sur les pages concernées de notre plateforme. Nous
          n'utilisons pas vos données au-delà de ce que nous divulguons : amélioration du contenu, fonctionnement
          interne, statistiques, sécurité, informations de contact, sécurité et règlement des litiges, publicité
          ciblée, support client.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Avec qui partageons-nous les données personnelles ?">
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">3.1 Employés</h3>
          <p>Nous pouvons divulguer à tout membre de notre organisation les données utilisateur dont il a raisonnablement besoin pour remplir les objectifs énoncés dans la présente politique.</p>
        </div>
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">3.2 Tierces parties</h3>
          <p className="mb-2">Nous pouvons partager des données utilisateur avec les tiers suivants :</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Organisateurs d'événements</strong> — informations des acheteurs pour l'accès aux événements</li>
            <li><strong>Prestataires de paiement</strong> — services certifiés pour les transactions</li>
            <li><strong>Services de messagerie</strong> — envoi de billets et notifications</li>
          </ul>
          <p className="mt-2">Les tiers ne pourront pas accéder aux données de l'utilisateur au-delà de ce qui est raisonnablement nécessaire pour atteindre l'objectif donné.</p>
        </div>
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">3.3 Autres divulgations</h3>
          <p className="mb-2">Nous nous engageons à ne pas vendre ou partager vos données avec d'autres tiers, sauf dans les cas suivants :</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>si la loi l'exige</li>
            <li>si elle est requise pour toute procédure judiciaire</li>
            <li>pour prouver ou protéger nos droits légaux</li>
            <li>aux acquéreurs ou acquéreurs potentiels de ClicBillet CI dans le cas où nous chercherions à la revendre en tout ou en partie</li>
          </ul>
          <p className="mt-2">
            Si vous suivez des hyperliens de notre plateforme vers un autre site, veuillez noter que nous ne
            sommes pas responsables et n'avons aucun contrôle sur leurs politiques et pratiques de
            confidentialité.
          </p>
        </div>
      </LegalSection>

      <LegalSection number={4} title="Combien de temps conservons-nous les données personnelles ?">
        <p>Nous ne conservons pas les données des utilisateurs au-delà de ce qui est nécessaire pour remplir les finalités pour lesquelles elles sont collectées.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="mb-1.5 font-bold text-gray-900">Mesures de sécurité</h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>Protocole SSL/TLS</li>
              <li>Cryptage des mots de passe</li>
              <li>Accès restreint aux employés</li>
              <li>Surveillance continue</li>
              <li>Sauvegardes sécurisées</li>
            </ul>
          </div>
          <div>
            <h4 className="mb-1.5 font-bold text-gray-900">Durées de conservation</h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>Compte actif : durée d'utilisation</li>
              <li>Données de transaction : 7 ans</li>
              <li>Données marketing : jusqu'au retrait</li>
              <li>Logs de sécurité : 1 an maximum</li>
            </ul>
          </div>
        </div>
      </LegalSection>

      <LegalSection number={5} title="Comment protégeons-nous les données personnelles ?">
        <p>Pour nous assurer que votre sécurité est protégée, nous utilisons le protocole de sécurité de la couche de transport pour transmettre des informations personnelles via notre système.</p>
        <p>Toutes les données stockées dans notre système sont bien sécurisées et ne sont accessibles qu'à nos employés. Nos employés sont liés par des accords de confidentialité stricts et une violation de cet accord entraînera le licenciement de l'employé.</p>
        <p>Bien que nous prenions toutes les précautions raisonnables pour nous assurer que nos données d'utilisateur soient sécurisées et que les utilisateurs soient protégés, il reste toujours un risque de préjudice. L'Internet dans son ensemble peut parfois être peu sûr et nous ne sommes donc pas en mesure de garantir la sécurité des données des utilisateurs au-delà de ce qui est raisonnablement pratique.</p>
      </LegalSection>

      <LegalSection number={6} title="Mineurs">
        <p>Les mineurs doivent avoir le consentement d'un représentant légal pour que leurs données soient collectées, traitées et utilisées.</p>
        <p>Nous n'avons pas l'intention de collecter ou d'utiliser les données d'utilisateurs mineurs. Si nous découvrons que nous avons collecté des données auprès d'un mineur, ces données seront immédiatement supprimées.</p>
      </LegalSection>

      <LegalSection number={7} title="Vos droits en tant qu'utilisateur">
        <p>Dans le cadre de nos engagements en matière de gestion et de protection des données personnelles, les utilisateurs disposent des droits suivants en tant que personnes concernées :</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {[
            "Droit d'accès",
            "Droit de rectification",
            "Droit à l'effacement",
            "Droit de restreindre le traitement",
            "Droit à la portabilité des données",
            "Droit d'objection",
          ].map((right) => (
            <div key={right} className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {right}
            </div>
          ))}
        </div>
      </LegalSection>

      <LegalSection number={8} title="Comment modifier, supprimer ou contester les données collectées ?">
        <p>Si vous souhaitez que vos informations soient supprimées ou autrement modifiées, veuillez contacter par mail notre responsable de la confidentialité des données :</p>
        <div className="rounded-xl border border-green-100 bg-green-50 p-4">
          <h4 className="mb-2 font-bold text-green-800">Contact Data Protection Officer (DPO)</h4>
          <ul className="space-y-1 text-green-900">
            <li><strong>Email spécialisé :</strong> privacy@clicbillet.com</li>
            <li><strong>Email général :</strong> contact@clicbillet.com</li>
            <li><strong>Téléphone :</strong> +225 07 02 49 02 77</li>
          </ul>
        </div>
      </LegalSection>

      <LegalSection number={9} title="Politique sur les cookies">
        <p>Un cookie est un petit fichier, stocké sur le disque dur d'un utilisateur par le site Web. Il a pour finalité de collecter des données relatives aux habitudes de navigation de l'utilisateur.</p>
        <p>Nous utilisons les types de cookies suivants sur notre plateforme :</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { title: "1. Cookies fonctionnels", body: "Nous les utilisons pour mémoriser toutes les sélections que vous effectuez sur notre plateforme afin qu'elles soient enregistrées pour vos futures visites." },
            { title: "2. Cookies analytiques", body: "Cela nous permet d'améliorer la conception et la fonctionnalité de notre plateforme en collectant des données sur le contenu auquel vous accédez." },
            { title: "3. Cookies de ciblage", body: "Cela nous permet d'améliorer la conception et la fonctionnalité de notre plateforme en collectant des données sur le contenu auquel vous accédez." },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border border-gray-100 p-3 text-center">
              <h4 className="mb-1.5 text-sm font-bold text-gray-900">{c.title}</h4>
              <p className="text-xs text-gray-500">{c.body}</p>
            </div>
          ))}
        </div>
        <p>Vous pouvez choisir d'être averti à chaque fois qu'un cookie est transmis. Vous pouvez également choisir de désactiver entièrement les cookies dans votre navigateur Internet, mais cela peut diminuer la qualité de votre expérience utilisateur.</p>
        <div>
          <h3 className="mb-1.5 font-bold text-orange-600">Cookies tiers</h3>
          <p>Nous pouvons utiliser des cookies tiers sur notre plateforme pour surveiller les préférences des utilisateurs afin d'adapter les publicités à leurs intérêts.</p>
        </div>
      </LegalSection>

      <LegalSection number={10} title="Transferts internationaux">
        <p>Vos données peuvent être transférées vers des serveurs situés :</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>En Côte d'Ivoire (stockage principal)</li>
          <li>En Europe (services cloud sécurisés)</li>
          <li>Avec des garanties appropriées de protection</li>
        </ul>
      </LegalSection>

      <LegalSection number={11} title="Modifications">
        <p>
          Cette politique de confidentialité peut être modifiée à l'occasion afin de maintenir la conformité
          avec la loi et de tenir compte de tout changement à notre processus de collecte de données. Nous
          recommandons à nos utilisateurs de vérifier notre politique de temps à autre pour s'assurer qu'ils
          soient informés de toute mise à jour. Au besoin, nous pouvons informer les utilisateurs par e-mail des
          changements apportés à cette politique.
        </p>
      </LegalSection>

      <LegalSection number={12} title="Contact">
        <p>Si vous avez des questions concernant cette politique de confidentialité, n'hésitez pas à nous contacter en utilisant les informations suivantes :</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-gray-50 p-4">
            <h4 className="mb-2 font-bold text-gray-900">ClicBillet CI</h4>
            <p className="mb-1 flex items-center gap-2"><MapPin className="h-4 w-4 text-orange-600" /> Abidjan, Cocody, Côte d'Ivoire</p>
            <p className="mb-1 flex items-center gap-2"><Mail className="h-4 w-4 text-orange-600" /> contact@clicbillet.com</p>
            <p className="mb-1 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-orange-600" /> privacy@clicbillet.com</p>
            <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-orange-600" /> +225 07 02 49 02 77</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-4">
            <h4 className="mb-2 font-bold text-gray-900">Horaires de support</h4>
            <p className="mb-1"><strong>Lundi - Vendredi :</strong> 8h - 18h</p>
            <p className="mb-1"><strong>Samedi :</strong> 9h - 15h</p>
            <p><strong>Dimanche :</strong> Fermé</p>
          </div>
        </div>
      </LegalSection>

      <p className="border-t border-gray-100 pt-6 text-center text-xs font-semibold text-gray-400">
        Date d'entrée en vigueur : le 1er janvier 2024
      </p>
    </LegalPage>
  );
}
