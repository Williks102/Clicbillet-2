# Relance organisateurs — campagne 2

Suite du premier envoi (100 organisateurs, 63 visiteurs, 0 compte créé).

Le premier mail a fait son travail : ~12 % de clic, c'est un bon taux. Le blocage
était en aval, dans le tunnel d'inscription. Cette relance ne réexplique donc pas
le produit — elle pose une question et ouvre une porte humaine.

**Format : texte brut, pas de HTML.** Contrairement à `email-organisateurs.html`,
ces messages doivent ressembler à un mail écrit par une personne. Une mise en page
soignée les ferait lire comme une campagne, or c'est précisément ce qu'on veut
éviter : on demande une réponse, pas un clic. Il n'y a donc pas de version HTML à
coller — le champ texte de la plateforme suffit.

**Désinscription.** Envoyés depuis une plateforme à une liste, les deux segments
doivent porter le lien de désinscription (bloc en bas de page). Envoyés un par un
depuis une boîte normale — ce que je recommande sous ~30 destinataires, cf.
`README.md` — retirez ce bloc : c'est de la correspondance individuelle.

---

## Segment A — les 73 qui n'ont pas cliqué

Ils n'ont pas ouvert, ou pas été intéressés par l'angle produit. On change
d'angle : question ouverte, aucune demande d'inscription.

**Objet** (tester les deux, 50/50) :
- `Vous avez un événement prévu bientôt ?`
- `Question rapide sur votre prochain événement`

**Pré-en-tête** : `Une seule question — répondez-moi en une ligne.`

```
Bonjour {{prenom}},

Je vous ai écrit il y a quelques jours au sujet de ClicBillet, notre
billetterie en ligne pour les événements en Côte d'Ivoire.

Je ne vais pas vous représenter le produit. J'ai juste une question :

Avez-vous un événement prévu dans les prochaines semaines ?

Si oui, répondez-moi en une ligne avec la date et le type d'événement.
Je regarde ce qui est faisable pour votre billetterie et je vous réponds
personnellement.

Si ce n'est pas le moment, dites-le moi aussi — je vous recontacterai
quand ce sera d'actualité, pas avant.

{{signature}}

PS : si vous préférez WhatsApp, écrivez-moi au {{numero_whatsapp}}.
C'est souvent plus rapide.
```

---

## Segment B — les visiteurs qui n'ont pas créé de compte

Ceux qui ont cliqué et sont repartis. Ils connaissent le produit : inutile de le
réexpliquer. On lève le frein et on propose de faire à leur place.

**Objet** : `Je vous crée votre premier événement, si vous voulez`

**Pré-en-tête** : `15 minutes au téléphone, et votre billetterie est en ligne.`

```
Bonjour {{prenom}},

Vous êtes passé sur ClicBillet cette semaine sans aller au bout de
l'inscription. C'est une information utile pour moi, donc merci.

Deux possibilités, et les deux m'intéressent :

1. Vous avez buté sur quelque chose.
   Dites-moi quoi, en une ligne. Nous venons de corriger plusieurs points
   sur l'inscription, et votre retour nous sert directement.

2. Ce n'était simplement pas le moment.
   Dans ce cas, gardez mon adresse et revenez quand vous aurez une date.

Et si vous voulez aller vite : je peux créer votre premier événement avec
vous. Vous me donnez le nom, la date, le lieu et vos tarifs — je m'occupe
du reste et vous recevez votre lien de vente prêt à partager.

Répondez « OK » à ce mail ou écrivez-moi sur WhatsApp au {{numero_whatsapp}},
et on cale 15 minutes.

{{signature}}
```

---

## Notes d'envoi

**Ce que ces mails ne font pas, volontairement :**

- Aucun bouton « Créer mon compte ». Le premier envoi a prouvé que le clic
  n'est pas le problème. Ici l'appel à l'action est une réponse, pas une
  inscription — c'est ce qui transforme un envoi de masse en conversation.
- Aucun argument tarifaire. Comparer les commissions se fait plus tard, et
  20 visites sur /tarifs disent que ceux qui voulaient comparer l'ont déjà fait.
- Aucune image, aucun HTML lourd. Un mail en texte simple, envoyé depuis une
  adresse nominative, passe mieux les filtres et se lit sans effort sur mobile.

**Paramètres :**

| Point | Choix |
|---|---|
| Expéditeur | une personne nommée, pas `contact@` ni `no-reply@` |
| Répondre à | une boîte réellement relevée — tout l'objet du mail est la réponse |
| Moment | mardi ou mercredi, 8 h – 9 h ou 19 h – 20 h (heure d'Abidjan) |
| Délai | au moins 5 jours après le premier envoi |
| Relance | une seule, à ceux qui n'ont pas répondu, 6 jours plus tard, en réponse au même fil |

**Ce qu'il faut mesurer cette fois.** Le taux de clic ne dira rien d'utile ici
puisqu'il n'y a pas de lien. Comptez : le nombre de **réponses**, le nombre de
**conversations WhatsApp ouvertes**, et le nombre d'**événements réellement créés**.
Une seule réponse vaut mieux que trente clics — c'est un interlocuteur identifié.

**À faire avant d'envoyer.** Vérifiez en base combien de comptes ont été créés
mais jamais confirmés depuis le premier envoi. S'il y en a, ce sont vos meilleurs
prospects : ils ont voulu s'inscrire. Écrivez-leur en priorité, avec le message du
segment C ci-dessous.

**Bloc de désinscription** (à ajouter en pied de chaque message envoyé depuis une
plateforme, à retirer pour un envoi individuel) :

```
--
ClicBillet — Billetterie en ligne, Côte d'Ivoire
contacts@clicbillet.com · www.clicbillet.com

Se désinscrire : {{{RESEND_UNSUBSCRIBE_URL}}}
```

---

## Segment C — les comptes créés mais jamais confirmés

Le segment le plus chaud de tous : ces personnes ont rempli le formulaire. Il ne
manque qu'un clic. À envoyer individuellement, sans attendre.

**Objet** : `Votre compte ClicBillet est créé — il manque une confirmation`

```
Bonjour {{prenom}},

Vous avez créé un compte sur ClicBillet, mais il n'a jamais été confirmé.
C'est notre faute : l'e-mail de confirmation n'était pas assez visible, et
rien ne vous permettait de le redemander.

C'est corrigé. Pour activer votre compte :

1. Allez sur https://www.clicbillet.com/connexion
2. Si vous n'avez plus l'e-mail de confirmation, cliquez sur
   « Renvoyer le lien » — vous le recevrez immédiatement.
3. Connectez-vous, et votre espace organisateur est prêt.

Si vous préférez, je peux créer votre premier événement avec vous en
15 minutes. Répondez à ce mail ou écrivez-moi au {{numero_whatsapp}}.

Désolé pour l'aller-retour,
{{signature}}
```
