# Audit de sécurité ClicBillet — 28 août 2026

## Portée et limites

- Revue statique de l'application TypeScript, du schéma Supabase, du build Vite et de la
  configuration Vercel versionnée dans ce dépôt.
- Tests non destructifs réalisés localement : compilation TypeScript, build de production et
  recherche de clés `service_role` / JWT dans le bundle public.
- Test HTTP externe tenté sur `https://www.clicbillet.com` et `https://clicbillet.com`, mais le
  proxy réseau de l'environnement a refusé le tunnel CONNECT (HTTP 403). Les en-têtes réellement
  servis n'ont donc pas pu être vérifiés dans cet audit.
- Aucun accès au tableau de bord Vercel ni au projet Supabase (ni identifiants de lecture seule)
  n'était disponible. L'état réel des variables d'environnement, des règles RLS appliquées et
  des paramètres Auth/Redirect URLs doit être vérifié par un administrateur suivant la checklist
  ci-dessous.

Ce document ne prétend pas remplacer un test d'intrusion authentifié conduit sur une preview
autorisée. Les tests actifs contre la production ont été limités à des requêtes HEAD, sans
création de compte, paiement, scan ou modification de données.

## Résultats

### Corrigé — critique : escalade de privilèges par métadonnées Supabase Auth

**Constat.** Le chemin de réparation exécuté à la connexion lorsqu'un utilisateur Supabase Auth
n'a pas encore de ligne dans `public.users` utilisait `authUser.user_metadata.role` pour créer le
profil. Les `user_metadata` sont définissables par l'utilisateur lors d'une inscription directe
avec la clé anon. Un attaquant pouvait ainsi créer hors application un compte Auth avec
`role: "admin"`, confirmer son email puis ouvrir une session dans l'application : le chemin de
réparation créait alors une ligne applicative `admin`.

**Correctif appliqué.** Le chemin de réparation attribue désormais systématiquement le rôle
`client`. Les changements vers `organizer` ou `admin` doivent passer par des routes serveur
autorisées.

**Validation effectuée.** Recherche de toutes les lectures de `user_metadata.role` : il n'en
reste aucune en dehors de ce chemin désormais sûr. Le build et le contrôle TypeScript passent.

### Conforme dans le code — gestion des catégories de prestataires

- Les routes d'administration des catégories demandent une session valide et le rôle `admin`.
- Les écritures API sont soumises au contrôle CSRF global `X-Requested-With: ClicBillet`.
- Les libellés sont bornés et transformés en slugs stables ; les doublons sont refusés.
- La suppression d'une catégorie encore utilisée devient une désactivation, afin de préserver
  l'intégrité des profils.
- La migration active la RLS de `vendor_categories` et ne définit qu'une politique SELECT pour
  les catégories actives ; aucune écriture publique n'est prévue.

### Conforme dans le code — paiements et secrets

- Le webhook Paystack vérifie la signature HMAC-SHA512 sur le corps brut avant traitement.
- La vérification initiée par le navigateur interroge Paystack côté serveur avec la clé secrète ;
  elle ne fait pas confiance au statut transmis par le navigateur.
- Le build public a été contrôlé : aucune clé Supabase `service_role` ni JWT de type service role
  n'y a été trouvé. Le script de build bloque aussi la publication d'une source map serveur dans
  `dist/`.
- Les cookies de session sont `httpOnly`, `secure` en production et `SameSite=Lax`; les routes
  d'écriture utilisent en plus une défense CSRF applicative.

## Risques résiduels et recommandations

| Priorité | Sujet | Action recommandée |
|---|---|---|
| Haute | État réel Supabase | Dans le dashboard, confirmer RLS activé et l'absence de policies INSERT/UPDATE/DELETE pour `anon`/`authenticated` sur `users`, `tickets`, `payouts`, `transactions`, `vendor_categories`, `vendor_profiles`, `vendor_profile_categories` et `vendor_leads`. Vérifier que seules les vues publiques nécessaires sont accordées. |
| Haute | Secrets et variables Vercel | Vérifier que `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `SUPABASE_WEBHOOK_SECRET` et `PAYOUT_DETAILS_ENCRYPTION_KEY` sont présents uniquement dans les variables serveur, jamais dans une variable `VITE_*`. Faire tourner les secrets de production si leur historique de partage est incertain. |
| Haute | Auth Supabase | Vérifier que la confirmation email est activée, que les Redirect URLs ne contiennent que les domaines attendus, et que l'URL de site est `https://www.clicbillet.com`. |
| Moyenne | Surface admin | Ajouter un journal d'audit immuable pour la création, le renommage, l'activation et la suppression de catégories ainsi que les changements de rôle. |
| Moyenne | Icônes de catégories | Valider côté serveur `icon` contre une liste blanche. L'interface le fait, mais l'API accepte actuellement toute chaîne. |
| Moyenne | XSS MFA | `ProfilePage` injecte le SVG de QR MFA via `dangerouslySetInnerHTML`. Le contenu provient aujourd'hui de Supabase Auth, mais une validation/assainissement SVG dédié réduirait l'impact d'une source compromise. |
| Moyenne | Observabilité | Renseigner `SENTRY_DSN` en production et configurer des alertes sur les refus de webhook, les erreurs de paiement et les tentatives d'accès interdit. |

## Checklist de vérification de production

### Supabase

1. **Authentication > URL Configuration** : confirmer `Site URL` et les `Redirect URLs` exacts,
   sans joker inutile ni domaines de test obsolètes.
2. **Authentication > Providers** : désactiver les fournisseurs non utilisés et vérifier la
   confirmation des e-mails.
3. **Database > Policies** : exporter ou relire les policies réellement appliquées ; comparer
   avec `supabase_setup.sql`.
4. **Database > Replication** : vérifier que seule la table `tickets` nécessaire au Realtime est
   publiée, et que sa policy ne permet qu'à l'acheteur de lire ses propres lignes.
5. Renouveler toute clé de service suspectée exposée et rechercher son empreinte dans les logs,
   l'historique Git et les variables de preview.

### Vercel

1. Vérifier que les variables de production sont définies au bon environnement et que les
   previews n'utilisent pas les clés Paystack de production.
2. Vérifier que `NODE_ENV=production`, `APP_ORIGIN=https://www.clicbillet.com` et
   `CRON_SECRET` sont définis en production.
3. Confirmer que les routes `/api/*` et `/e/:id` vont vers `server.ts`, et que les réponses
   statiques conservent les headers de `vercel.json`.
4. Avec un compte de test, contrôler en production les headers HSTS, CSP, `X-Frame-Options`,
   `X-Content-Type-Options`, `Referrer-Policy` et `Permissions-Policy`.
5. Vérifier que le planificateur externe envoie bien les deux routes cron avec le header
   `Authorization: Bearer <CRON_SECRET>`.

## Tests à réaliser sur une preview autorisée

1. Sans session, appeler chaque endpoint `/api/admin/*` : attendre `401`.
2. Avec un compte client/organisateur, appeler les mêmes endpoints : attendre `403`.
3. Avec un administrateur, créer puis désactiver une catégorie de test ; confirmer qu'elle
   apparaît/disparaît des formulaires et filtres publics comme prévu.
4. Depuis un navigateur tiers, tenter un POST sans `X-Requested-With: ClicBillet` : attendre
   `403` sans effet de bord.
5. Envoyer un webhook Paystack avec signature invalide : attendre `401`, sans changement de
   billet ; réaliser ensuite un paiement de faible montant pour vérifier le flux légitime.
6. Créer directement un utilisateur Supabase Auth de test avec
   `user_metadata.role = "admin"`, puis se connecter : il doit recevoir un profil `client`,
   jamais `admin`.
7. Vérifier un IDOR : un compte A ne doit pas lire/transférer/scanner les billets du compte B ni
   modifier les ressources d'un autre organisateur.
