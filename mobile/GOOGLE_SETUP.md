# Activer « Continuer avec Google » (app Android)

Le code est prêt (app + route serveur `POST /api/auth/google`). Tant que les étapes ci-dessous
ne sont pas faites, le bouton Google **n'apparaît pas** dans l'app. Tout se fait depuis un navigateur.

Valeurs à connaître :

| Élément | Valeur |
|---|---|
| Nom du paquet Android | `ci.clicbillet.app` |
| SHA-1 de la clé de signature de l'APK actuel | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` |

> ⚠️ Ce SHA-1 est celui de la clé de test par défaut d'Expo, partagée par tous les projets Expo.
> Elle suffit pour essayer l'app sur votre téléphone. Avant de publier sur le Play Store, créez une
> clé de signature dédiée à ClicBillet : il faudra alors ajouter son SHA-1 (étape 3) et réinstaller l'app.

## 1. Google Cloud : écran de consentement
1. https://console.cloud.google.com → créez (ou choisissez) un projet « ClicBillet ».
2. *API et services → Écran de consentement OAuth* : type **Externe**, nom « ClicBillet », e-mail d'assistance,
   domaine autorisé `clicbillet.com`. Portées : `email`, `profile`, `openid` (par défaut).
3. Tant que l'app est en mode « Test », ajoutez vos comptes Google dans *Utilisateurs test*.
   Pour que tout le monde puisse se connecter, passez l'écran en **Production**.

## 2. ID client « Application Web » (utilisé par Supabase et par l'app)
1. *API et services → Identifiants → Créer des identifiants → ID client OAuth*.
2. Type **Application Web**, nom « ClicBillet Web ». Dans « URI de redirection autorisés », ajoutez
   l'URL de rappel affichée par Supabase (Supabase → Authentication → Providers → Google → *Callback URL*,
   de la forme `https://<projet>.supabase.co/auth/v1/callback`).
3. Notez l'**ID client** (`xxxx.apps.googleusercontent.com`) et le **secret client**.

## 3. ID client « Android »
1. Même écran → ID client OAuth → type **Android**.
2. Nom du paquet : `ci.clicbillet.app` ; empreinte SHA-1 : celle du tableau ci-dessus.
3. Notez l'ID client Android (il ne va pas dans l'app, seulement dans Supabase, étape 4).

## 4. Supabase
1. Authentication → Providers → **Google** : activer.
2. *Client IDs* : mettez l'ID **Web**, une virgule, puis l'ID **Android**, **sans aucun espace** (`web_id,android_id`) : Supabase refuse les espaces.
3. *Client Secret* : le secret de l'ID Web.
4. Activez **Skip nonce checks** : la bibliothèque Google native ne fournit pas de nonce à Supabase.
5. Enregistrez.

## 5. Reconstruire l'app avec l'ID Web
Dans `mobile/.env` :

```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxxx.apps.googleusercontent.com
```

puis recompilez l'APK (ou demandez-le à Claude en lui donnant l'ID Web : ce n'est pas un secret).
Le **serveur doit aussi être redéployé** (route `/api/auth/google`).

## Dépannage
- *« DEVELOPER_ERROR » / connexion refusée par Google* : le paquet ou le SHA-1 de l'ID Android ne correspond pas à la clé qui signe l'APK installé.
- *« Connexion Google refusée »* (message de l'app) : l'ID Web/Android n'est pas dans la liste « Client IDs » de Supabase, ou « Skip nonce checks » n'est pas activé.
- *Le bouton n'apparaît pas* : l'APK a été compilé sans `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
- Un compte Google dont l'e-mail correspond à un compte ClicBillet existant s'y rattache (e-mail Google vérifié requis). Il ne devient jamais organisateur ou admin automatiquement.
