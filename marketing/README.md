# E-mail de prospection organisateurs

`email-organisateurs.html` — version HTML, à coller dans l'outil d'envoi.
`email-organisateurs.txt` — version texte, à coller dans le champ prévu à cet effet.

## Avant d'envoyer

**Remplacer `{{lien_desinscription}}`** par la balise de votre outil d'envoi (Brevo, Mailchimp,
Resend…). Un lien de désinscription est obligatoire pour un envoi commercial, et c'est aussi
le premier facteur qui décide si vous arrivez en boîte de réception ou en indésirables.

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
