# Publier ClicBillet sur le Google Play Store

Version préparée : **1.3.0 (versionCode 5)**, paquet `ci.clicbillet.app`. Les règles de Google évoluent :
vérifiez chaque point dans la Play Console au moment de publier.

## 0. Ce qui est déjà prêt côté technique
- Fichier **AAB** signé avec la clé d'upload ClicBillet (`clicbillet-upload.keystore`).
- Permissions réduites : caméra + Internet + réseau (plus de micro, plus de stockage, plus de « superposition »).
- Connexion e-mail et Google, onboarding, billets QR, scanner, achat via le site.

Empreintes de la **clé d'upload** (utile uniquement pour tester l'AAB hors Play Store) :
- SHA-1 : `68:DE:26:A1:A2:FC:A5:03:FA:10:9B:E2:3B:B9:6E:86:CA:27:E2:CC`

> 🔐 La clé d'upload et ses mots de passe sont dans `LISEZ-MOI-cle.txt` (remis dans la conversation).
> Sauvegardez-les dans un gestionnaire de mots de passe **et** faites une copie du fichier `.keystore`.
> Ne les mettez jamais dans Git. Si vous les perdez, le support Play peut réinitialiser la clé d'upload, mais c'est long.

## 1. Compte développeur Google Play (vous)
1. https://play.google.com/console → créer un compte, **25 $ une fois**, vérification d'identité.
2. **Compte personnel** : un test fermé de **12 testeurs pendant 14 jours consécutifs** est exigé avant la production.
   **Compte organisation** (entreprise + numéro D-U-N-S) : pas de test fermé obligatoire, mais vérification plus longue.

## 2. Créer l'application
1. *Créer une application* : nom « ClicBillet », langue par défaut **français**, type **Application**, **Gratuite**.
2. Acceptez les déclarations (politique du programme, lois d'exportation).
3. Activez **Play App Signing** (par défaut) : à la première importation, Google conserve la clé de signature finale
   et vous gardez la clé d'upload.

## 3. Fiche du store
- Description courte (80 caractères) et description longue, en français.
- **Icône 512×512** (PNG), **image de présentation 1024×500**, **au moins 2 captures d'écran** de téléphone.
- Catégorie : *Événements* (ou *Divertissement*). E-mail de contact : `contacts@clicbillet.com`.
- **URL de la politique de confidentialité** : `https://www.clicbillet.com/confidentialite`.

## 4. Questionnaires « Contenu de l'application »
| Rubrique | Quoi répondre |
|---|---|
| Politique de confidentialité | URL ci-dessus (voir §7 pour la mettre à jour) |
| Accès à l'application | **Compte obligatoire** → fournir un compte de test (e-mail + mot de passe) que les relecteurs de Google utiliseront. Sans lui, l'app est refusée. |
| Annonces | Aucune publicité |
| Classification du contenu | Questionnaire : app de billetterie, pas de contenu sensible |
| Public cible | **18 ans et plus** (pas d'enfants) |
| Sécurité des données | Collecte : nom, e-mail, achats, identifiants du compte, identifiant d'appareil non collecté. Données chiffrées en transit : **oui**. Suppression de compte possible : **oui** (voir §6). Partage : prestataires de paiement (Paystack), messagerie. |
| Suppression de compte | Indiquer l'URL web de suppression + le chemin dans l'app (§6) |
| Applications financières, santé, gouvernement | Non |
| Paiements | Billets d'événements réels : **pas besoin de Google Play Billing** |

## 5. Importer et publier
1. *Test interne* → *Créer une version* → importer `ClicBillet-1.3.0.aab` → ajouter des testeurs (e-mails Google) → publier.
   Installez l'app depuis le lien de test et vérifiez : onboarding, inscription/connexion, billets, scanner, achat (WebView), **bouton Google**.
2. *Test fermé* (compte personnel) : 12 testeurs, 14 jours, puis *Demander l'accès à la production*.
3. *Production* → *Créer une version* → choisir les pays → envoyer à la révision. Premier examen : de quelques jours à une semaine.
4. À chaque nouvelle version : augmenter `versionCode` (et `version`) dans `mobile/app.json`, recompiler l'AAB.

## 6. Suppression de compte (obligatoire pour une app avec création de compte)
Google exige : une option **dans l'app** et une **page web** où l'on peut demander la suppression.
À mettre en place (voir le plan avec Claude) : bouton « Supprimer mon compte » dans Profil, route serveur `DELETE /api/account`,
page `https://www.clicbillet.com/supprimer-mon-compte`.

## 7. Politique de confidentialité : à compléter avant publication
La page `/confidentialite` existe (`src/components/legal/PrivacyPage.tsx`) mais ne couvre pas l'app. À ajouter (texte juridique : à valider par vous) :
- Mention de **l'application mobile Android** et des données qu'elle traite (compte, e-mail, billets, identifiant de session).
- **Caméra** : utilisée uniquement par les organisateurs pour scanner les QR codes ; aucune image n'est enregistrée ni envoyée.
- **Connexion avec Google** : données reçues de Google (nom, e-mail), Google cité parmi les tiers (§3.2).
- **Suppression de compte** : procédure dans l'app et sur le web, en plus de l'e-mail DPO (§8).
- Conservation : les données de transaction (7 ans) sont conservées de façon anonymisée après suppression du compte.

## 8. Connexion Google après le passage au Play Store
Avec Play App Signing, l'APK installé depuis le store est signé par **Google**, pas par votre clé d'upload :
1. Play Console → *Configuration → Intégrité de l'application* → copier le **SHA-1 du certificat de signature d'application**.
2. Google Cloud → *Identifiants* → l'ID client **Android** (`ci.clicbillet.app`) → ajouter cette empreinte (vous pouvez en ajouter plusieurs : gardez aussi celle de la clé d'upload et celle de la clé de test).
3. Sans cette étape, le bouton Google échouera (« DEVELOPER_ERROR ») sur la version du Play Store.
4. Passer l'écran de consentement OAuth de « Test » à **Production**, sinon seuls vos comptes test pourront se connecter.

## 9. Recompiler l'AAB (pour les développeurs)
```bash
cd mobile
export ANDROID_KEYSTORE_PATH=/chemin/clicbillet-upload.keystore
export ANDROID_KEY_ALIAS=clicbillet-upload
export ANDROID_KEYSTORE_PASSWORD=...   # voir LISEZ-MOI-cle.txt
export ANDROID_KEY_PASSWORD=...
export EXPO_PUBLIC_API_URL=https://www.clicbillet.com
export EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com
npx expo prebuild --platform android --clean
cd android && ./gradlew bundleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64
# → android/app/build/outputs/bundle/release/app-release.aab
```
Le plugin `plugins/withReleaseSigning.js` lit ces variables ; sans elles, le build reste signé avec la clé de test d'Expo.
