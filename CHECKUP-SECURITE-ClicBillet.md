# Check-up sécurité ClicBillet — guide de vérification pour Claude Code

> **Pour l'agent (Claude Code dans VS Code).** Ce document est une checklist d'audit à dérouler
> **fichier par fichier dans le code réel**, pas une liste de conclusions. Pour chaque item :
> 1. Ouvre le(s) fichier(s) indiqué(s) et/ou lance la commande `rg` (ripgrep) fournie.
> 2. Compare au **Critère PASS**.
> 3. Coche `[x]` si conforme, laisse `[ ]` et note l'écart sinon.
>
> L'analyse initiale n'a couvert que `server.ts` (≈ lignes 1–1000 sur 2270), `supabase_setup.sql`,
> `index.html`, `SECURITY-FIXES.md`, `WEBHOOK-SECURITY-PATCH.md`. **Tout le reste est à vérifier**,
> en particulier le corps des routes de `server.ts` au-delà de la ligne 1000 et tout le dossier `src/`.

## Légende de sévérité

| Niveau | Sens |
|---|---|
| 🔴 CRITIQUE | Exploitable, impact direct (fraude, accès total). À traiter en premier. |
| 🟠 ÉLEVÉ | Affaiblit fortement la sécurité ou facilite une autre attaque. |
| 🟡 MOYEN | Durcissement / dette de sécurité. |
| 🔵 INFO | Hygiène, process, à confirmer. |

## Fichiers à lire intégralement (priorité de revue)

- [ ] `server.ts` **en entier** (2270 lignes) — surtout les routes après la ligne 1000
- [ ] `src/components/CheckoutModal.tsx`
- [ ] `src/App.tsx`
- [ ] `src/components/AdminDashboard.tsx`
- [ ] `src/components/OrganizerDashboard.tsx`
- [ ] `src/main.tsx` et tout autre fichier de `src/`
- [ ] `vercel.json`, `vite.config.ts`, `tsconfig.json`
- [ ] `package.json` + `package-lock.json`
- [ ] `.env.example`, `.gitignore`
- [ ] `db.json` (vérifier qu'il ne contient pas de données sensibles commitées)
- [ ] `scripts/`, `download_sdk.js`, `metadata.json`
- [ ] `test_init.js`, `test_redirect.js`, `test_scope.js`, `test_www.js`, `temp_payment_test.js`

---

## A. Chaîne de paiement / webhook 🔴 (risque n°1)

- [ ] **A1 — Le statut de paiement est revérifié en server-to-server.** 🔴
  Le serveur ne doit pas faire confiance au `status` reçu dans la notification ; il doit
  rappeler l'API PaiementPro avec la référence de transaction pour obtenir le statut autoritatif
  avant d'émettre un billet.
  `rg -n "payment/callback" server.ts` puis lire toute la route.
  **PASS** : un appel sortant (`fetch`/SDK) vers PaiementPro vérifie le statut avant `INSERT` du ticket.
  **FAIL** : le ticket est créé directement à partir du `status`/`payment_success` reçu.

- [ ] **A2 — Aucun appel frontend vers la route de callback.** 🔴
  `rg -n "payment/callback" src/`
  **PASS** : 0 résultat dans `src/`. Toute simulation passe par une route `/api/dev/*` gardée.
  **FAIL** : `CheckoutModal.tsx` ou `App.tsx` appellent `/api/payment/callback` avec `status:"SUCCESS"`.

- [ ] **A3 — Le fallback `PaiementPro` simulé n'émet jamais de billet en prod.** 🔴
  `rg -n "isFallback|payment_success|getUrlPayment" index.html src/`
  Vérifier que la redirection `?payment_success=true` ne déclenche **aucune** finalisation de billet
  côté serveur sans vérification A1.
  **PASS** : le fallback n'aboutit qu'à un message d'erreur/UX, jamais à un ticket validé.
  **FAIL** : un chemin client peut produire un billet sans paiement réel.

- [ ] **A4 — Incohérence HMAC vs réalité PaiementPro.** 🟠
  `rg -n "verifyPaymentSignature|createHmac|x-paiementpro-signature" server.ts`
  Le doc webhook dit que PaiementPro **ne signe pas**. Déterminer si `verifyPaymentSignature` est
  réellement appelée sur la route de callback.
  **PASS** : soit la fonction est branchée et PaiementPro signe vraiment (à confirmer), soit elle est
  retirée au profit d'un mécanisme effectif. Pas de code mort qui donne une fausse assurance.
  **FAIL** : fonction présente mais jamais appelée, ou appelée mais jamais satisfiable.

- [ ] **A5 — Secret `?wh=` traité comme filtre, pas comme preuve.** 🟠
  `rg -n "PAYMENT_WEBHOOK_SECRET|req.query.wh|\\bwh\\b" server.ts`
  **PASS** : la vérif `wh` rejette en `401` ET A1 reste la vraie garantie.
  **FAIL** : le `wh` est l'unique barrière entre une requête et l'émission d'un billet.

- [ ] **A6 — CORS de la route callback non permissif.** 🟡
  `rg -n "Access-Control-Allow-Origin" server.ts`
  **PASS** : pas de `*` sur `/api/payment/callback` (webhook serveur-à-serveur).
  **FAIL** : `Access-Control-Allow-Origin: *` présent sur cette route.

- [ ] **A7 — Idempotence / anti-rejeu du callback.** 🟠
  Vérifier qu'un rejeu d'une notification valide ne crée pas de billet en double ni ne double
  `tickets_sold`. La contrainte `UNIQUE(transaction_ref)` aide mais ne suffit pas seule.
  **PASS** : la route vérifie l'état existant (ex. ticket déjà `PAID`) avant toute écriture.

- [ ] **A8 — `/api/admin/validate-payment` protégée.** 🔴
  `rg -n "validate-payment" server.ts`
  **PASS** : route sous `/api/admin/*` (donc `requireAuth + requireRole("admin")`) **et** chaque
  validation manuelle est journalisée avec l'identité de l'admin.
  **FAIL** : route déclarée hors du préfixe protégé, ou sans log d'audit.

---

## B. Authentification & autorisation 🟠

- [ ] **B1 — Toutes les routes sensibles passent par `requireAuth`.** 🔴
  Lister toutes les routes : `rg -n "app\\.(get|post|put|patch|delete|all)\\(" server.ts`
  Repérer celles qui touchent tickets/transactions/payouts/users/export et confirmer la protection.
  **PASS** : aucune route de données privées sans `requireAuth`.

- [ ] **B2 — `/api/my-tickets` ignore le `buyerId` du client (anti-IDOR).** 🟠
  `rg -n "my-tickets|buyerId|buyer_id" server.ts`
  **PASS** : la route force `buyer_id = req.user.id` et ignore toute valeur reçue.
  **FAIL** : `buyerId` lu depuis `req.query`/`req.body`.

- [ ] **B3 — `/api/organizer/*` vérifie rôle ET ownership.** 🟠
  `app.use("/api/organizer", requireAuth)` ne vérifie **pas** le rôle. Confirmer que chaque route
  vérifie `organizer_id === req.user.id` (sauf admin).
  **PASS** : ownership vérifié par route + `requireRole("organizer","admin")` le cas échéant.

- [ ] **B4 — Token fallback `local-<id>` non exploitable en prod.** 🟠
  `rg -n "local-|startsWith\\(\"local" server.ts`
  Le bearer `local-<id>` est un identifiant non signé → `Bearer local-usr-admin` = admin.
  **PASS** : le mode fallback est **désactivé** en production (démarrage qui échoue si Supabase absent),
  ou les tokens locaux sont signés.
  **FAIL** : le fallback reste actif en prod avec tokens devinables.

- [ ] **B5 — Le rôle n'est jamais lu depuis le body/query.** 🟠
  `rg -n "req.body.role|req.query.role|body\\.role" server.ts src/`
  **PASS** : le rôle provient toujours de la table `users` côté serveur.

- [ ] **B6 — Bug RLS du login corrigé (clients Supabase séparés).** 🟠
  `rg -n "signInWithPassword|createClient|service_role" server.ts`
  **PASS** : `signInWithPassword` se fait sur un client dédié ; les `INSERT/SELECT` sur `users`
  passent par un client `service_role` qui n'a jamais ouvert de session utilisateur.
  **FAIL** : même instance réutilisée (cause de l'erreur RLS « new row violates… »).

---

## C. RLS & Supabase 🟠

- [ ] **C1 — RLS actif sur les 5 tables.** ✅ (vu dans `supabase_setup.sql`, à reconfirmer en base)
  Dans le dashboard Supabase : Authentication > Policies → RLS ON sur `users, events, tickets,
  payouts, transactions`. **Le fichier SQL ne garantit pas l'état réel de la base de prod.**

- [ ] **C2 — Aucune écriture publique involontaire.** 🟡
  Vérifier qu'aucune policy `anon/authenticated` n'autorise l'écriture hors `events` approuvés en lecture.
  **PASS** : deny-by-default conservé sauf la policy de lecture publique.

- [ ] **C3 — Aucune clé `service_role` exposée au frontend.** 🔴
  `rg -n "SERVICE_ROLE|service_role" src/ index.html vite.config.ts`
  `rg -n "VITE_.*SERVICE|VITE_.*SECRET" .`
  **PASS** : 0 résultat. Aucune variable `service_role` préfixée `VITE_`.
  **FAIL** : une clé sensible atteignable depuis le bundle client.

- [ ] **C4 — Vérif anti-fuite dans le build.** 🟡
  Après `npm run build`, `rg -n "eyJ" dist/` (préfixe JWT) et `rg -n "service_role" dist/`.
  **PASS** : aucun JWT/clé sensible dans `dist/`.

---

## D. Secrets & configuration 🟠

- [ ] **D1 — Aucun secret commité.** 🔴
  `rg -n "eyJ[A-Za-z0-9_-]{20,}" .` (JWT) ; `rg -ni "api[_-]?key|secret|password" .env.example`
  Vérifier l'historique : `git log --all -p -- .env .env.local 2>/dev/null | rg -n "eyJ|KEY|SECRET"`
  **PASS** : `.env*` ignorés (`.gitignore`), `.env.example` ne contient que des placeholders.

- [ ] **D2 — `.gitignore` couvre bien les secrets et artefacts.** 🟡
  `rg -n "env|node_modules|dist|db.json" .gitignore`
  **PASS** : `.env`, `.env.local`, `node_modules`, `dist` ignorés.

- [ ] **D3 — `db.json` ne contient pas de vraies données.** 🟡
  Ouvrir `db.json`. Il est commité dans le repo.
  **PASS** : pas de hash/PII de vrais utilisateurs ; idéalement le retirer du suivi Git.

- [ ] **D4 — `vercel.json` : pas de secret en clair, headers cohérents.** 🟡
  Lire `vercel.json` ; vérifier qu'aucune variable sensible n'y est en dur et que les éventuels
  headers de sécurité ne contredisent pas le CSP d'Express.

---

## E. CSP, frontend & supply chain 🟠

- [ ] **E1 — Retirer `'unsafe-inline'` de `scriptSrc`.** 🟠
  `rg -n "unsafe-inline|scriptSrc|scriptSrcAttr" server.ts`
  Le script inline d'`index.html` force `'unsafe-inline'`, ce qui affaiblit le CSP contre le XSS.
  **PASS** : logique de bootstrap déplacée dans un fichier externe avec hash/nonce, `'unsafe-inline'` retiré.

- [x] **E2 — SRI sur le SDK PaiementPro.** 🟠 — **RISQUE ACCEPTÉ (22/06/2026)**
  `rg -n "paiementpro.*\\.js" index.html`
  Vérifié en direct (`curl -sI https://paiementpro.net/webservice/onlinepayment/js/paiementpro.v1.0.1.js`) :
  le CDN ne renvoie **aucun** header `Access-Control-Allow-Origin`. `integrity` exige un chargement
  `crossorigin="anonymous"`, qui exige lui-même un header CORS côté serveur distant — sans ça, le
  navigateur bloque le script. Impossible d'ajouter SRI sans casser le chargement réel du SDK
  PaiementPro (contrainte du CDN tiers, hors de notre contrôle). Décision : accepter le risque,
  payer fonctionne, priorité à la disponibilité du paiement. Alternative possible si requis un jour :
  auto-héberger une copie vérifiée du SDK sous `public/` pour reprendre la main sur SRI.

- [x] **E3 — CSP vérifié en conditions réelles avant/après activation.** 🔵
  Pas de phase `Report-Only` formelle, mais vérification directe post-déploiement
  (`curl -I https://www.monticket.online/`) confirmant la présence du CSP et un parcours
  d'achat réel testé sans régression PaiementPro. `connectSrc`/`scriptSrc` couvrent le domaine
  PaiementPro réellement utilisé (`*.paiementpro.net`). Pas de Supabase côté client : le frontend
  ne parle qu'à `/api/*` (même origine), Supabase n'est appelé que côté serveur — `*.supabase.co`
  n'a donc pas besoin d'être dans `connectSrc`.

- [x] **E4 — Headers complémentaires présents.** 🟡 — **CORRIGÉ (22/06/2026)**
  `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS désormais injectés via
  `vercel.json` (route catch-all avec `continue: true`), car `helmet` côté `server.ts` ne couvrait
  que `/api/*` — la page statique servie par Vercel ne passait jamais par Express. Vérifié en direct
  sur `www.monticket.online` : tous les headers sont présents.

- [ ] **E5 — Pas de `dangerouslySetInnerHTML` ni d'injection DOM.** 🟠
  `rg -n "dangerouslySetInnerHTML|innerHTML|eval\\(|new Function" src/`
  **PASS** : aucun, ou strictement contrôlé.

---

## F. Validation des entrées 🟡

- [ ] **F1 — Remplacer la sanitization regex par une validation de schéma.** 🟡
  `rg -n "sanitizeString|sanitizeObject|REDACTED_EVENT_HANDLER" server.ts`
  La mutation globale de `req.body/query/params` + regex est fragile et corrompt des données légitimes.
  **PASS** : validation par schéma (ex. `zod`) en entrée + encodage à l'affichage (React échappe déjà).
  **Note** : ne pas retirer la sanitization sans mettre la validation à la place d'abord.

- [ ] **F2 — Montants/quantités validés côté serveur.** 🟠
  `rg -n "quantity|price|amount" server.ts` dans la route checkout.
  **PASS** : le **prix est recalculé côté serveur** depuis l'event, jamais pris du body client.
  **FAIL** : `pricePaid`/`amount` provient du frontend.

- [ ] **F3 — Pas de log de données sensibles.** 🟡
  `rg -n "console\\.(log|info|warn|error)" server.ts | rg -i "password|token|card|secret|wh="`
  **PASS** : aucun mot de passe, token, secret `wh`, ni donnée de carte journalisé.

---

## G. Fallback local (`db.json`) 🟡

- [ ] **G1 — Hash bcrypt partout dans le fallback.** ✅ (vu : `bcrypt.hashSync` / `compareSync`)
  Reconfirmer qu'aucune comparaison `u.password === password` ne subsiste.
  `rg -n "=== password|password ===|compareSync|hashSync" server.ts`

- [ ] **G2 — Blocage dur en production sans Supabase.** 🟠
  `rg -n "NODE_ENV|isSupabaseEnabled" server.ts`
  **PASS** : en prod, l'absence de Supabase **arrête** le serveur (au lieu d'un simple `console.error`).

---

## H. Fichiers de test & artefacts à nettoyer 🔵

- [ ] **H1 — Retirer les scripts de test du repo / de la prod.** 🔵
  `test_init.js`, `test_redirect.js`, `test_scope.js`, `test_www.js`, `temp_payment_test.js`,
  `download_sdk.js`. Vérifier qu'ils ne contiennent pas de secrets ni d'endpoints internes et qu'ils
  ne sont pas servis publiquement par Vercel.
  `rg -ni "key|secret|token|http" test_*.js temp_payment_test.js download_sdk.js`

- [ ] **H2 — Pas de route de debug exposée.** 🟠
  `rg -n "/api/dev|/debug|/test|simulate" server.ts`
  **PASS** : toute route de simulation est gardée par `NODE_ENV !== "production"`.

---

## I. Dépendances 🟡

- [ ] **I1 — `npm audit` propre.** 🟡
  `npm audit --production` → 0 vulnérabilité haute/critique.

- [ ] **I2 — Versions épinglées et lockfile cohérent.** 🔵
  Vérifier que `package-lock.json` est commité et à jour (`npm ci` doit passer).

- [ ] **I3 — Pas de dépendance inutile côté client.** 🔵
  S'assurer que les libs serveur (`bcryptjs`, `helmet`, `@supabase/supabase-js` admin) ne fuient pas
  dans le bundle frontend.

---

## J. Process & cohérence doc/code 🔵

- [ ] **J1 — Réconcilier `SECURITY-FIXES.md` / `WEBHOOK-SECURITY-PATCH.md` avec le code réel.**
  Marquer chaque section « ✅ implémenté (commit …) » ou « ⏳ à faire ». Les plans au futur ne doivent
  pas être pris pour des correctifs en place.

- [ ] **J2 — Travailler en branche + preview Vercel pour tout changement paiement.** ✅ (déjà recommandé)

- [ ] **J3 — Tests de non-régression sécurité** après corrections :
  - Appel direct `/api/admin/*` sans token → `401`.
  - `/api/payment/callback` sans `wh` / forgé → `401`, **et** aucun billet créé.
  - `/api/my-tickets?buyerId=<autre>` connecté → renvoie *ses* tickets, pas ceux demandés.
  - CDN PaiementPro bloqué → aucun billet émis via le fallback.

---

## Synthèse rapide des priorités

1. **A1–A3, A8** (paiement falsifiable + fallback simulé + validate-payment) → 🔴 à traiter en premier.
2. **B4, C3, D1** (token local forgeable, fuite `service_role`, secrets commités) → 🔴/🟠.
3. **E1–E2** (CSP `unsafe-inline`, SRI) → 🟠.
4. **B2–B3, A7, F2** (IDOR, idempotence, prix recalculé serveur) → 🟠.
5. **F1, G2, H1–H2** (validation schéma, blocage prod, nettoyage tests) → 🟡.

> Le point structurant reste **A1** : tant que l'émission de billet n'est pas adossée à une
> vérification server-to-server du statut réel auprès de PaiementPro, le reste des protections
> (token `wh`, CORS) ne fait que réduire le bruit, pas garantir le paiement.
