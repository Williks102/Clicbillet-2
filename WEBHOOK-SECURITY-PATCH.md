# Correctif ciblé — Sécurisation du webhook de paiement (sans casser le matching existant)

## Contexte important avant de commencer

Aucun commit n'a encore été fait sur les modifications majeures que Copilot a déjà appliquées suite aux recommandations du document `SECURITY-FIXES.md` initial. **Avant toute nouvelle modification, faire un commit de l'état actuel.** Ça permet de revenir en arrière facilement si une nouvelle modification casse quelque chose, et de garder une trace claire de ce qui a déjà changé vs ce que ce document demande en plus.

```bash
git add -A
git commit -m "WIP: corrections sécurité auth, paiement, RLS (suite audit) — avant ajout token webhook"
```

## Ce qu'on sait maintenant (résumé de l'enquête)

Un bug de matching de référence entre `ticket.id` et `transaction_ref` a bloqué plusieurs tickets payés en `PENDING` dans la nuit du 16 au 17 juin. Copilot a corrigé ce bug en élargissant la logique de recherche (plusieurs candidats de référence, recherche sur deux colonnes). **Ce correctif fonctionne et ne doit pas être modifié** — il a été vérifié empiriquement sur plusieurs transactions réelles après son déploiement (toutes réussies depuis le 17 juin 02h11).

**Mais ce correctif résout un problème de fiabilité, pas un problème de sécurité.** Il a été confirmé par le support Paiement Pro/XPAYE qu'aucun hashcode ou signature n'est obligatoire sur cette plateforme actuellement. Le webhook `/api/payment/callback` ne vérifie donc toujours l'identité de personne : il fait confiance à quiconque envoie une requête qui ressemble à une notification de paiement, et la logique de recherche élargie (qui aide à retrouver le bon ticket pour les paiements légitimes) facilite mécaniquement aussi qu'une requête forgée par un attaquant trouve un ticket à débloquer frauduleusement.

**Principe directeur de ce correctif : ajouter une couche de protection en amont, sans toucher à la logique de matching qui fonctionne actuellement.**

---

## 1. [PRIORITAIRE] Token secret de validation du webhook

### Objectif
Filtrer les requêtes illégitimes sur `/api/payment/callback` **avant** qu'elles n'atteignent la logique de recherche de ticket existante, sans modifier cette logique.

### Principe
Générer un secret aléatoire côté serveur, l'inclure comme paramètre dans le `notificationURL` envoyé à Paiement Pro lors de l'initialisation du paiement. Paiement Pro relaiera cette URL telle quelle (avec le paramètre) lors de la notification. Le serveur vérifie ce paramètre avant toute autre logique.

### Implémentation demandée

**Étape 1 — Variable d'environnement.** Ajouter dans `.env` (et dans la configuration Vercel) :
```
PAYMENT_WEBHOOK_SECRET=<générer une valeur aléatoire longue, ex: openssl rand -hex 32>
```

**Étape 2 — Inclure le secret dans `notificationURL` à la création du paiement.** Dans la route qui initialise le paiement (`/api/checkout` ou équivalent, là où `notificationURL` est construite), modifier :
```js
// Avant
const notificationURL = `${BASE_URL}/api/payment/callback`;

// Après
const notificationURL = `${BASE_URL}/api/payment/callback?wh=${process.env.PAYMENT_WEBHOOK_SECRET}`;
```

**Étape 3 — Vérifier le secret en tout premier dans le callback.** Dans `server.ts`, route `/api/payment/callback`, ajouter cette vérification **avant** toute la logique existante de recherche de ticket (ne rien retirer de l'existant après cette vérification) :
```js
app.all("/api/payment/callback", async (req: express.Request, res: express.Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // à restreindre séparément, cf. section 2
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // NOUVEAU : vérification du secret avant tout traitement
  const providedSecret = req.query.wh;
  if (!providedSecret || providedSecret !== process.env.PAYMENT_WEBHOOK_SECRET) {
    console.warn("[PaiementPro Callback] Tentative rejetée : secret webhook absent ou invalide.", {
      ip: req.ip,
      query: req.query
    });
    return res.status(401).json({ status: "error", message: "Non autorisé" });
  }

  // === à partir d'ici, code existant inchangé ===
  console.log("=== CALLBACK PAIEMENT PRO REÇU ===");
  // ... reste du code existant, ne pas modifier ...
});
```

**Important : ne pas toucher au code qui suit cette vérification.** Toute la logique de recherche de ticket (`refCandidates`, `.or(...)`, normalisation de référence) doit rester identique à ce qui fonctionne actuellement.

**Étape 4 — Logger les tentatives rejetées.** Le `console.warn` ci-dessus permet de surveiller dans les logs Vercel si des tentatives suspectes arrivent sans le bon secret, ce qui servirait d'indicateur si quelqu'un essaie d'exploiter ce endpoint.

### Pourquoi cette approche et pas une autre
Ne dépend pas d'un mécanisme de signature côté Paiement Pro (qui n'existe pas/n'est pas obligatoire). Ne nécessite aucune modification de la logique de matching de référence qui vient d'être stabilisée. Isolé et testable séparément : si quelque chose casse, on sait immédiatement que c'est cette vérification précise, pas le matching.

### Limite à connaître
Si jamais l'URL complète (avec le secret en paramètre) fuit quelque part (logs publics, capture d'écran partagée, requête visible dans les outils réseau du navigateur si jamais elle y transite), le secret est compromis et doit être régénéré. C'est pour ça que l'étape suivante (restriction CORS / méthode) reste recommandée en complément, pas en remplacement.

---

## 2. [IMPORTANT] Retirer les appels frontend qui simulent un succès de paiement

### Problème, rappel
Dans `CheckoutModal.tsx`, trois branches appellent directement `/api/payment/callback` avec `status: "SUCCESS"` depuis le navigateur du client : succès SDK, échec SDK, SDK non chargé. Le frontend ne devrait jamais pouvoir déclencher cette route lui-même.

### Correctif demandé
Supprimer ces trois appels `fetch("/api/payment/callback", ...)` dans `CheckoutModal.tsx`. Si un mode de test local sans webhook réel est nécessaire pour le développement, créer une route séparée et clairement nommée, par exemple `/api/dev/simulate-payment`, qui n'existe et ne répond que si `process.env.NODE_ENV !== "production"` :
```js
if (process.env.NODE_ENV !== "production") {
  app.post("/api/dev/simulate-payment", async (req, res) => {
    // logique de simulation, séparée et explicitement non-production
  });
}
```
Le frontend en mode développement appelle cette route distincte, jamais la vraie route de callback. Ça évite toute confusion entre "simuler pour tester" et "le vrai webhook de production".

### Fichiers concernés
`src/components/CheckoutModal.tsx`, `server.ts`.

---

## 3. [COMPLÉMENTAIRE, à faire après validation des points 1 et 2] Restriction CORS

Une fois le token (point 1) en place et testé, restreindre l'en-tête `Access-Control-Allow-Origin: *` actuellement présent sur `/api/payment/callback`. Comme il n'y a pas de liste d'IP fixe confirmée par Paiement Pro, retirer simplement le wildcard `*` et ne pas autoriser de origin spécifique côté navigateur pour cette route (un vrai webhook serveur-à-serveur n'a pas besoin de CORS permissif, CORS ne concerne que les requêtes depuis un navigateur).

---

## 4. [Information, pas une urgence] Les 6 tickets historiques en PENDING

Les 6 tickets identifiés plus haut (`tkt-1781653905704`, `tkt-1781601283057`, `tkt-1781585037650`, `tkt-1781581382357`, `tkt-1781578706661`, `tkt-1781578192710`) correspondent à des tests personnels effectués pendant le débogage du bug de matching, pas à de vrais clients en attente. **Pas une urgence**, peuvent rester en `PENDING` ou être nettoyés de la base à l'occasion, sans impact sur de vrais utilisateurs.

À noter : la route `/api/admin/validate-payment`, qui permet de débloquer manuellement un ticket bloqué (utilisée pour résoudre ce genre de cas avant même le patch automatique de Copilot), reste un outil de dépannage utile à garder. Mais elle est actuellement accessible sans aucune authentification — n'importe qui connaissant l'URL peut valider n'importe quel ticket comme payé, qu'il ait réellement payé ou non. C'est couvert par la section 1 du document `SECURITY-FIXES.md` (middleware `requireAuth` + `requireRole("admin")`), à appliquer aussi à cette route spécifiquement, indépendamment du calendrier de ce document-ci.

---

## Stratégie Git : branche séparée + test en preview avant merge

Ne pas travailler directement sur la branche principale pour ce correctif. Vu le contexte (système de paiement en production, bug récent qui a affecté de vrais clients), il faut pouvoir tester et revenir en arrière facilement.

```bash
# Après le commit de l'état actuel sur la branche principale (voir ci-dessus)
git checkout -b feature/webhook-security-token
```

Faire tout le travail des points 1, 2 et 3 ci-dessous sur cette branche. Pousser la branche pour obtenir une URL de preview Vercel séparée de la production :

```bash
git push -u origin feature/webhook-security-token
```

**Tester sur l'environnement de preview avant tout merge**, en particulier :
- Un paiement réel complet (petit montant) qui doit aboutir à un ticket `PAID` avec QR code visible, pour confirmer que le nouveau paramètre `?wh=...` dans `notificationURL` n'empêche pas Paiement Pro de relayer correctement la notification.
- Un paiement annulé, qui doit rester bloqué en `PENDING` comme avant.
- Une requête forgée manuellement vers `/api/payment/callback` sans le paramètre `wh` (ou avec une valeur incorrecte), qui doit maintenant être rejetée avec un `401`, là où elle aurait pu passer avant.

Une fois ces trois cas validés sur la preview, merger dans la branche principale et déployer en production :
```bash
git checkout main
git merge feature/webhook-security-token
git push
```

Si un problème apparaît après le merge, revenir en arrière reste simple avec `git revert`, plutôt que de devoir isoler le problème au milieu de plusieurs changements non séparés.

---

## Ordre d'exécution recommandé

1. Commit de l'état actuel sur la branche principale (voir tout en haut de ce document).
2. Créer la branche `feature/webhook-security-token` (voir section "Stratégie Git" ci-dessus).
3. Point 1 (token secret) sur cette branche — tester en preview avant prod.
4. Point 2 (suppression des appels frontend simulant un succès) sur cette branche.
5. Commit sur la branche, push, tester les trois scénarios listés dans la section "Stratégie Git" sur l'environnement de preview.
6. Si les tests passent : merger dans la branche principale et déployer en production.
7. Point 3 (restriction CORS), après confirmation que le token fonctionne en prod depuis quelques jours sans incident — peut se faire sur une nouvelle petite branche du même type, ou directement si la confiance est suffisante.
8. Appliquer aussi le middleware d'authentification (section 1 de `SECURITY-FIXES.md`) sur `/api/admin/validate-payment`, pour protéger cet outil de dépannage manuel qui reste utile mais actuellement ouvert à tous.
