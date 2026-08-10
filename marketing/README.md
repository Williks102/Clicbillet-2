# Prospection organisateurs

Deux approches, pour deux usages différents. Ne les confondez pas : envoyer le HTML depuis une
boîte personnelle produit le pire des deux mondes — un message qui a l'air d'une campagne,
sans les outils d'une campagne.

| | Campagne | Prospection individuelle |
|---|---|---|
| Fichiers | `email-organisateurs.html` + `.txt` | `prospection-individuelle.md` |
| Envoi | Plateforme (Resend, Brevo…) | Boîte normale, un par un |
| Mise en forme | HTML mis en page | Texte brut |
| Destinataires | Liste d'inscrits volontaires | Contacts qu'on sait nommer |
| Volume | Illimité | 10-15 par jour |
| Désinscription | Lien obligatoire | Sans objet (correspondance individuelle) |

**À 290 contacts, la prospection individuelle rend davantage** : 10-20 % de réponses contre
quelques pour cent, et aucun risque pour la réputation du domaine qui achemine vos billets.
La campagne devient pertinente quand vous aurez une liste d'inscrits.

---

## Campagne

`email-organisateurs.html` — version HTML, à coller dans l'outil d'envoi.
`email-organisateurs.txt` — version texte, à coller dans le champ prévu à cet effet.

## Envoi via Resend Broadcasts

Le fichier est prêt pour Resend : le pied de page contient `{{{RESEND_UNSUBSCRIBE_URL}}}`
(trois accolades), que Resend remplace par le lien de désinscription en ajoutant les en-têtes
`List-Unsubscribe` exigés par Gmail et Yahoo pour l'envoi de masse. Sur une autre plateforme,
remplacer par la balise correspondante.

**Ne PAS envoyer avec `sendEmail()` de l'application.** Cette fonction sert au transactionnel :
ni désinscription, ni en-têtes de masse, ni liste de suppression. Un envoi commercial par ce
chemin abîme la réputation du domaine qui achemine les billets payés.

Étapes :

1. **Domaine d'envoi séparé.** Dans Resend, ajouter un sous-domaine dédié au marketing
   (`mail.clicbillet.com`) et publier ses enregistrements DNS. La réputation d'expéditeur se
   joue au niveau du domaine : une campagne qui génère des plaintes ne doit pas pouvoir
   dégrader la délivrabilité des e-mails de billets.
2. **Audience** : créer l'audience, importer les contacts.
3. **Broadcast** : coller le HTML, coller la version texte, choisir l'audience.
4. **Expéditeur** : un nom de personne sur le sous-domaine, et une adresse de réponse
   réellement relevée — le message invite explicitement à répondre.
5. **Test** avant diffusion : s'envoyer le message et le contrôler sur Gmail ET Outlook.

**Coller les deux versions.** Un e-mail envoyé en HTML seul est un signal de courrier
indésirable pour la plupart des filtres. La version texte n'est presque jamais lue par un
humain — elle sert à passer.

## Objets suggérés

Le premier est le plus direct, testez-en deux sur des moitiés de liste :

- Vendez vos billets en ligne, sans rien avancer
- 6 % sur vos billets vendus. Rien d'autre.
- Votre billetterie en ligne peut ouvrir aujourd'hui
- Organisateurs : arrêtez d'imprimer vos billets

Nom d'expéditeur : une personne plutôt qu'une marque (« Koffi de ClicBillet » ouvre mieux que
« ClicBillet »). Adresse de réponse réelle : le message invite explicitement à répondre.

## Ce qui a été vérifié

Rendu contrôlé à 700 px et à 390 px de large. Mise en page en tableaux, styles en ligne,
aucune image externe et aucune police distante : rien à télécharger, donc rien qui casse si
les images sont bloquées — ce qui est le cas par défaut chez beaucoup de destinataires.

Les boutons ont une variante VML pour Outlook, qui n'applique pas `border-radius` sur un lien.

## Ce qui reste à faire de votre côté

Le pied de page ne porte pas d'adresse postale. Selon votre outil d'envoi et le pays de vos
destinataires, elle peut être exigée — vérifiez auprès de votre prestataire.
