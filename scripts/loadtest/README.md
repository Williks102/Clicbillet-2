# Campagne de charge

Deux volets, répondant à deux questions différentes.

## 1. Contention — « vend-on plus de places qu'il n'en existe ? »

```bash
node scripts/loadtest/checkout-contention.mjs "postgres://…"
MODE=avant node scripts/loadtest/checkout-contention.mjs "postgres://…"   # séquence historique
```

Rejoue contre un vrai PostgreSQL portant le schéma de `supabase_setup.sql` la séquence de
requêtes qu'émet `POST /api/checkout`, avec des dizaines d'acheteurs simultanés sur le même
événement. Vérifie l'invariant qui compte pour un billetteur : **le nombre de billets émis ne
dépasse jamais le nombre de places en vente**, ni globalement ni par catégorie tarifaire.

Le test porte sur la séquence SQL plutôt que sur la couche HTTP parce que c'est là que vit la
course : la concurrence entre acheteurs se joue dans l'ordre des lectures et des écritures sur
la ligne `events`, pas dans Express.

Sort en code 1 si une survente est détectée — utilisable en intégration continue.

Pour l'exécuter contre un PostgreSQL local plutôt que la base de production :

```bash
createdb clicbillet && psql -d clicbillet -f supabase_setup.sql   # les GRANT Supabase échouent, sans conséquence
node scripts/loadtest/checkout-contention.mjs "postgres://localhost/clicbillet"
```

## 2. HTTP — « à partir de quand ça décroche ? »

```bash
node scripts/loadtest/http.mjs http://localhost:3000 10,50,100,200,400
```

Mesure débit et temps de réponse par palier de visiteurs simultanés, sur le profil de trafic
d'une mise en vente (l'essentiel du trafic consulte, une minorité achète). Chaque visiteur
simulé porte sa propre adresse IP : sans cela on mesurerait le limiteur de débit et non
l'application.

Attention à l'interprétation : le générateur envoie des requêtes en continu, bien plus vite
qu'un visiteur réel. Les refoulements (429) aux faibles paliers viennent de cette agressivité
artificielle, pas d'un défaut.
