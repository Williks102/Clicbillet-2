// Campagne de charge — couche HTTP.
//
// Mesure ce que voit un visiteur : débit tenu et temps de réponse, sur le profil de trafic
// réel d'une mise en vente — l'écrasante majorité des requêtes consulte le catalogue et la
// page d'un événement, une minorité achète.
//
// Complément du volet contention (checkout-contention.mjs), qui vérifie lui la justesse du
// stock. Ici on ne cherche pas une erreur de logique mais un point de rupture : à partir de
// quelle simultanéité les temps de réponse décrochent.
//
//   Usage : node scripts/loadtest/http.mjs [URL_DE_BASE] [PALIERS]
//   ex.   : node scripts/loadtest/http.mjs http://localhost:3000 10,50,100,200
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const PALIERS = (process.argv[3] || "10,50,100,200").split(",").map(Number);
const DUREE_MS = Number(process.env.DUREE_MS || 5000);

// Chaque visiteur simulé porte sa propre adresse (le serveur fait confiance à
// X-Forwarded-For derrière son proxy) : sans cela, tout le trafic vient d'une seule IP et
// c'est le limiteur de débit qu'on mesure, pas l'application.
const parcours = [
  { nom: "catalogue", poids: 6, req: (ip) => fetch(`${BASE}/api/events`, { headers: { "X-Forwarded-For": ip } }) },
  { nom: "recherche", poids: 3, req: (ip) => fetch(`${BASE}/api/events?category=Concert`, { headers: { "X-Forwarded-For": ip } }) },
  { nom: "connexion", poids: 1, req: (ip) => fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-requested-with": "ClicBillet", "X-Forwarded-For": ip },
      body: JSON.stringify({ email: `charge${Math.random()}@x.ci`, password: "mauvais" })
    }) },
];
const tirage = parcours.flatMap((p) => Array(p.poids).fill(p));

const centile = (tries, c) => tries.length ? tries[Math.min(tries.length - 1, Math.floor(tries.length * c))] : 0;

async function palier(vus) {
  const latences = [];
  const codes = {};
  const fin = Date.now() + DUREE_MS;
  let enCours = true;

  const vu = async (n) => {
    const ip = `41.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
    while (Date.now() < fin) {
      const p = tirage[Math.floor(Math.random() * tirage.length)];
      const t0 = performance.now();
      try {
        const r = await p.req(ip);
        await r.arrayBuffer();
        codes[r.status] = (codes[r.status] || 0) + 1;
      } catch (e) {
        codes["réseau"] = (codes["réseau"] || 0) + 1;
      }
      latences.push(performance.now() - t0);
    }
  };

  const t0 = Date.now();
  await Promise.all(Array.from({ length: vus }, (_, n) => vu(n + 1)));
  const secondes = (Date.now() - t0) / 1000;
  enCours = false;

  latences.sort((a, b) => a - b);
  // Un 429 n'est PAS une réponse utile : c'est un visiteur refoulé. Un 401 sur une
  // tentative de connexion volontairement erronée en est une (le serveur a fait son travail).
  const total = Object.values(codes).reduce((a, n) => a + n, 0);
  const refoules = Number(codes["429"] || 0);
  const echecs = Object.entries(codes).filter(([c]) => c === "réseau" || Number(c) >= 500).reduce((a, [, n]) => a + n, 0);
  const ok = total - refoules - echecs;
  return {
    vus,
    rps: Math.round(total / secondes),
    p50: Math.round(centile(latences, 0.5)),
    p95: Math.round(centile(latences, 0.95)),
    p99: Math.round(centile(latences, 0.99)),
    tauxOk: total ? ((ok / total) * 100).toFixed(1) : "0",
    refoules, echecs,
    codes,
  };
}

console.log(`\n=== Campagne de charge HTTP — ${BASE} (${DUREE_MS / 1000}s par palier) ===\n`);
console.log("  visiteurs |  req/s |  p50   |  p95   |  p99   | utiles | refoulés | échecs");
console.log("  ----------|--------|--------|--------|--------|--------|----------|-------");
for (const vus of PALIERS) {
  const r = await palier(vus);
  console.log(
    `  ${String(r.vus).padStart(9)} | ${String(r.rps).padStart(6)} | ${String(r.p50 + "ms").padStart(6)} | ${String(r.p95 + "ms").padStart(6)} | ${String(r.p99 + "ms").padStart(6)} | ${String(r.tauxOk + "%").padStart(6)} | ${String(r.refoules).padStart(8)} | ${String(r.echecs).padStart(6)}`
  );
}
console.log("\n  p95 = 19 requêtes sur 20 répondent en moins de ce temps.");
