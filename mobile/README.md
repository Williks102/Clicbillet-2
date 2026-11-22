# ClicBillet — app mobile native (Expo / React Native)

Client iOS/Android qui consomme l'API existante du backend (cookies de session httpOnly, aucune modif serveur).

## Fonctionnalités v1
- Catalogue d'événements, recherche, détail et choix du billet
- Connexion (y compris double authentification)
- « Mes billets » avec QR code (respecte le verrouillage du QR avant l'événement)
- Scanner de billets pour organisateurs/admins (caméra → `/api/verify-ticket`)
- Réservation des événements gratuits dans l'app ; les billets payants sont finalisés sur le site (popup Paystack)

## Lancer
```bash
cd mobile
cp .env.example .env     # EXPO_PUBLIC_API_URL = URL du backend
npm install
npx expo start           # scanner le QR avec Expo Go, ou: npm run android / ios
```

## Prochaines étapes
- Paiement in-app : ajouter un endpoint serveur d'initialisation Paystack (URL de paiement) + WebView
- Inscription depuis l'app, mot de passe oublié, transfert de billets
- Icône / splash, build store via EAS (`eas build`)
