# Plan de correction sécurité — ClicBillet

Contexte : application React + Express + Supabase. Audit a révélé plusieurs failles critiques de contrôle d'accès et de validation de paiement. Ce document liste les correctifs à implémenter, par ordre de priorité. Chaque section peut être soumise à Copilot indépendamment.

---

## 1. [CRITIQUE] Aucune authentification sur les routes admin/organizer

### Problème
Les routes suivantes n'ont aucune vérification d'identité ni de rôle côté serveur :
- `GET /api/admin/stats`
- `GET /api/admin/transactions`
- `GET /api/admin/payouts`
- `POST /api/admin/validate-payment`
- `GET /api/organizer/export`
- `GET /api/my-tickets` (IDOR via `buyerId` en query param)

Le rôle (`admin`, `organizer`, `client`) n'est vérifié que côté frontend React, jamais côté serveur. N'importe qui peut appeler ces endpoints directement.

### Correctif demandé
Créer un middleware Express `requireAuth` qui :
1. Lit le header `Authorization: Bearer <token>`.
2. Vérifie le token via `supabase.auth.getUser(token)`.
3. Récupère le profil (`role`) depuis la table `users` en base — jamais depuis le body/query envoyé par le client.
4. Attache `req.user = { id, role, email }` à la requête.
5. Renvoie `401` si le token est absent/invalide.

Créer un second middleware `requireRole(...roles)` qui renvoie `403` si `req.user.role` n'est pas dans la liste autorisée.

Appliquer :
- `requireAuth, requireRole("admin")` sur toutes les routes `/api/admin/*`.
- `requireAuth, requireRole("organizer", "admin")` sur `/api/organizer/export`, en vérifiant en plus que `organizerId` correspond à `req.user.id` (sauf si admin).
- `requireAuth` sur `/api/my-tickets`, en forçant `buyerId = req.user.id` (ignorer toute valeur de `buyerId` envoyée par le client).

Côté frontend, envoyer le token Supabase (`session.access_token`) dans le header `Authorization` sur tous les `fetch()` vers ces routes.

### Fichiers concernés
`server.ts`, `src/components/AdminDashboard.tsx`, `src/components/OrganizerDashboard.tsx`, `src/App.tsx` (gestion de session).

---

## 2. [CRITIQUE] Paiement falsifiable — pas de vérification réelle côté serveur

### Problème
`POST /api/payment/callback` :
- Autorise CORS depuis n'importe quelle origine (`Access-Control-Allow-Origin: *`) et toutes les méthodes.
- Accepte un `status: "SUCCESS"` envoyé directement par le frontend (le navigateur du client), pas seulement par le serveur du prestataire Paiement Pro.
- Aucune vérification de signature/HMAC pour confirmer que la requête vient bien de Paiement Pro.

Conséquence : un attaquant peut générer un billet payant sans payer, en appelant cette route avec n'importe quelle référence `PENDING-*`.

### Correctif demandé
1. Supprimer tous les appels frontend vers `/api/payment/callback` avec `status: "SUCCESS"` (dans `src/App.tsx` et `src/components/CheckoutModal.tsx`). Le frontend ne doit jamais pouvoir déclencher la validation d'un paiement.
2. Restreindre CORS sur cette route à l'IP/domaine du prestataire Paiement Pro uniquement (retirer `Access-Control-Allow-Origin: *`).
3. Implémenter la vérification de signature fournie par Paiement Pro (HMAC ou équivalent selon leur doc API) avant de traiter tout callback. Rejeter avec `401` si la signature est absente ou invalide.
4. Pour le mode développement local (sans webhook externe joignable), créer une route séparée `POST /api/dev/simulate-payment`, activée uniquement si `NODE_ENV !== "production"`, plutôt que de réutiliser la route de callback réelle.
5. Revoir `POST /api/admin/validate-payment` (validation manuelle) : la protéger par `requireRole("admin")` (cf. section 1) et logger chaque validation manuelle avec l'identité de l'admin qui l'a faite (table d'audit).

### Fichiers concernés
`server.ts`, `src/App.tsx`, `src/components/CheckoutModal.tsx`.

---

## 3. [CRITIQUE] Risque d'exposition de la clé `service_role` Supabase

### Problème
`server.ts` essaie plusieurs variables d'environnement (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`) et choisit automatiquement celle qui "ressemble" à une clé valide. Ce mécanisme de détection augmente le risque qu'une clé `service_role` (qui contourne RLS) soit mal configurée ou finisse exposée côté client via une variable préfixée `VITE_`.

### Correctif demandé
1. Supprimer la détection automatique de clé. Utiliser explicitement deux clients Supabase distincts :
   - Un client **anon** (`SUPABASE_ANON_KEY`), utilisé pour toute opération qui doit respecter RLS (lecture d'events publics, etc.).
   - Un client **service_role** (`SUPABASE_SERVICE_ROLE_KEY`), utilisé uniquement côté serveur pour les opérations admin explicitement protégées par `requireRole("admin")`.
2. Vérifier qu'aucune variable contenant la clé `service_role` n'est préfixée `VITE_` (tout ce qui commence par `VITE_` est exposé au bundle frontend par Vite).
3. Ajouter un script de vérification CI qui grep le build frontend (`dist/`) à la recherche du préfixe `eyJ` (JWT) pour détecter une fuite de clé avant déploiement.

### Fichiers concernés
`server.ts`, `.env`, configuration de déploiement (Vercel env vars).

---

## 4. [ÉLEVÉ] Mots de passe en clair dans le fallback local `db.json`

### Problème
Quand Supabase n'est pas disponible, l'app bascule silencieusement sur une base JSON locale qui stocke les mots de passe en clair, y compris pour l'inscription (`db.users.push(newUser)` avec `password` brut) et la comparaison à la connexion (`u.password === password`).

### Correctif demandé
1. Si le fallback local doit être conservé pour le développement, hacher les mots de passe avec `bcrypt` avant stockage, et comparer avec `bcrypt.compare`.
2. Ajouter un log d'avertissement bien visible (et idéalement bloquer le démarrage en `NODE_ENV=production`) si l'app démarre sans Supabase configuré, pour éviter qu'un fallback non sécurisé tourne en prod par accident.
3. Supprimer les comptes de démo en clair (`admin@clicbillet.ci` / `password123`, etc.) de `INITIAL_DATABASE`, ou au minimum les exclure du build de production.

### Fichiers concernés
`server.ts`.

---

## 5. [ÉLEVÉ] IDOR sur `/api/my-tickets` et `/api/organizer/export`

### Problème
Ces routes acceptent `buyerId` / `organizerId` en paramètre de requête sans vérifier que l'appelant correspond bien à cet ID.

### Correctif
Couvert par la section 1 (middleware `requireAuth`). S'assurer concrètement que :
- `/api/my-tickets` ignore tout `buyerId` reçu et utilise exclusivement `req.user.id`.
- `/api/organizer/export` vérifie `organizerId === req.user.id` sauf si `req.user.role === "admin"`.

---

## 6. [MOYEN] Logique de migration d'auth fragile

### Problème
Le code tente de migrer automatiquement, au moment du login, un utilisateur créé par script SQL (mot de passe en clair en base) vers Supabase Auth, via une requête `eq("password", password)`. Cette logique de "auto-healing" est complexe, difficile à auditer, et repose sur la comparaison d'un mot de passe en clair.

### Correctif demandé
Remplacer cette migration automatique à la volée par un script de migration ponctuel, exécuté une seule fois manuellement (hors requête HTTP), qui transfère les comptes existants vers Supabase Auth avec des mots de passe temporaires à réinitialiser par email. Supprimer la branche de migration automatique de la route `/api/auth/login`.

### Fichiers concernés
`server.ts`.

---

## 7. [MOYEN] Row Level Security (RLS) Supabase

### Problème
Non vérifié directement dans le code fourni, mais étant donné l'usage massif du client `service_role` qui contourne RLS, il est probable que les policies RLS sur les tables `users`, `tickets`, `events`, `transactions` soient absentes ou insuffisantes.

### Correctif demandé
1. Activer RLS sur toutes les tables.
2. Ajouter des policies :
   - `users` : un utilisateur ne peut lire/modifier que sa propre ligne (`auth.uid() = id`) ; lecture complète réservée au rôle `service_role` côté serveur.
   - `tickets` : un client ne peut lire que ses propres tickets (`buyer_id = auth.uid()`) ; un organisateur ne peut lire que les tickets liés à ses événements.
   - `events` : lecture publique, écriture réservée à l'organisateur propriétaire (`organizer_id = auth.uid()`) ou à l'admin.
   - `transactions` : lecture réservée à l'admin (via service_role côté serveur uniquement).

### Fichiers concernés
Migrations SQL Supabase (à créer si absentes), dashboard Supabase.

---

## 7bis. [CRITIQUE] RLS explicitement désactivé en base

### Problème
Le fichier `supabase_setup.sql` contient ces lignes, exécutées lors de la mise en place de la base :

```sql
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions DISABLE ROW LEVEL SECURITY;
```

RLS est donc désactivé sur toutes les tables sensibles. Si jamais la clé `anon` (censée être limitée par RLS) est utilisée n'importe où — y compris potentiellement exposée côté frontend — elle donne un accès en lecture/écriture total à toutes les données : utilisateurs, tickets, transactions, reversements aux organisateurs.

Le même fichier insère aussi les comptes de démo avec mots de passe en clair directement en SQL (`'password123'`), cohérent avec le problème de la section 4.

### Correctif demandé
1. Supprimer ces lignes `DISABLE ROW LEVEL SECURITY` du script SQL.
2. Réactiver RLS sur les 5 tables avec `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`.
3. Écrire les policies décrites en section 7 avant de réactiver RLS, sinon le client anon n'aura plus aucun accès (même en lecture publique sur `events`).
4. Retirer les insertions SQL de mots de passe en clair (`'password123'`) du script ; les comptes de démo doivent être créés via `supabase.auth.admin.createUser()`, jamais par INSERT SQL direct sur `public.users`.
5. Ré-exécuter le script corrigé sur l'environnement de production, puis vérifier dans le dashboard Supabase (Authentication > Policies) que RLS est bien actif sur chaque table.

### Fichiers concernés
`supabase_setup.sql`.

---

## 8. [ÉLEVÉ] Absence de Content-Security-Policy (CSP)

### Problème
Aucune politique CSP n'est définie nulle part : pas de meta tag dans `index.html`, pas de header envoyé par Express, pas de configuration dans `vercel.json`. De plus, `index.html` charge un script tiers externe sans Subresource Integrity :

```html
<script src="https://paiementpro.net/webservice/onlinepayment/js/paiementpro.v1.0.1.js"></script>
```

Sans CSP, en cas de faille XSS ailleurs dans l'app (input non échappé, librairie compromise, etc.), un script injecté peut charger des ressources depuis n'importe quel domaine, exfiltrer des données (tokens, infos de carte bancaire saisies dans `CheckoutModal.tsx`) vers un serveur contrôlé par l'attaquant, sans aucune restriction du navigateur.

### Correctif demandé
1. Ajouter un middleware Express qui pose les headers de sécurité sur toutes les réponses HTML (utiliser le package `helmet`, ou les headers manuellement) :

```js
import helmet from "helmet";

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://paiementpro.net"],
      connectSrc: ["'self'", "https://*.supabase.co", "https://paiementpro.net"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      styleSrc: ["'self'", "'unsafe-inline'"], // 'unsafe-inline' nécessaire si Tailwind injecte du style inline ; à resserrer si possible
      frameSrc: ["https://paiementpro.net"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", "https://paiementpro.net"],
    },
  },
  crossOriginEmbedderPolicy: false, // à activer seulement si le SDK de paiement le supporte
}));
```

Ajuster `scriptSrc`/`connectSrc`/`frameSrc` selon les domaines réels utilisés par Paiement Pro (vérifier dans leur documentation s'ils utilisent des sous-domaines ou redirigent vers un autre domaine pendant le paiement).

2. Ajouter un attribut `integrity` (hash SRI) et `crossorigin="anonymous"` sur le `<script>` externe de Paiement Pro dans `index.html`, si leur CDN le permet (vérifier que le fichier ne change pas fréquemment, sinon le hash cassera le chargement à chaque mise à jour de leur SDK) :

```html
<script
  src="https://paiementpro.net/webservice/onlinepayment/js/paiementpro.v1.0.1.js"
  integrity="sha384-<hash-a-calculer>"
  crossorigin="anonymous"
></script>
```

3. Ajouter aussi les headers complémentaires via `helmet` (inclus par défaut) : `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (ou `SAMEORIGIN` si une iframe de paiement est nécessaire), `Referrer-Policy: strict-origin-when-cross-origin`.

4. Tester en mode `Content-Security-Policy-Report-Only` d'abord pendant quelques jours pour repérer les violations légitimes (ressources oubliées) avant de passer en mode bloquant strict, car une CSP trop stricte peut casser le SDK de paiement ou le rendu Tailwind.

### Fichiers concernés
`server.ts` (ajout du middleware), `index.html` (attribut SRI), `package.json` (ajout de la dépendance `helmet`).

---

## Ordre d'implémentation recommandé

1. Section 1 (middleware auth + rôle) — bloque la majorité des failles d'accès.
2. Section 2 (vérification webhook paiement) — bloque la fraude financière.
3. Section 3 (séparation clés anon/service_role) + Section 7bis (réactiver RLS, qui est actuellement désactivé) — à faire ensemble, l'un ne marche pas sans l'autre.
4. Section 7 (policies RLS détaillées) en même temps que la 7bis.
5. Section 8 (CSP) — réduit l'impact d'une éventuelle faille XSS, complémentaire aux corrections d'accès.
6. Sections 4, 5, 6 — durcissement complémentaire.

Après implémentation, retester manuellement : accès direct aux routes `/api/admin/*` sans token (doit renvoyer 401), tentative de validation de paiement sans signature webhook (doit échouer), accès à `/api/my-tickets?buyerId=<autre-id>` en étant connecté en tant qu'un autre utilisateur (doit renvoyer ses propres tickets, pas ceux demandés).
