// Campagne de charge — contention sur la vente de billets.
//
// Rejoue, sous concurrence réelle et contre un vrai PostgreSQL portant le schéma de
// production, la SÉQUENCE EXACTE de requêtes qu'émet POST /api/checkout (server/routes/
// checkout.ts, branche Supabase). L'intérêt n'est pas de mesurer un débit : c'est de vérifier
// l'INVARIANT qui compte pour un billetteur — ne jamais vendre plus de places qu'il n'en
// existe.
//
// Le test porte sur la séquence SQL et non sur la couche HTTP, parce que c'est là que vit la
// course : la concurrence entre acheteurs se joue dans l'ordre des lectures et des écritures
// sur la ligne "events", pas dans Express.
//
//   Usage : node scripts/loadtest/checkout-contention.mjs [URL_POSTGRES]
import pg from "pg";

const URL = process.argv[2] || process.env.DATABASE_URL;
if (!URL) { console.error("Usage: node checkout-contention.mjs <url-postgres>"); process.exit(1); }

const pool = new pg.Pool({ connectionString: URL, max: 60 });
const q = (t, p) => pool.query(t, p);

async function prepareEvent({ id, total, tiers }) {
  await q(`DELETE FROM tickets WHERE event_id = $1`, [id]);
  await q(`DELETE FROM events WHERE id = $1`, [id]);
  await q(
    `INSERT INTO events (id, title, description, date, time, price, venue, category, tickets_sold, total_tickets, organizer_id, organizer_name, status, ticket_types)
     VALUES ($1,'Concert de charge','','2030-01-01','20:00',5000,'Palais','Concert',0,$2,'org-1','Orga','approved',$3)`,
    [id, total, tiers ? JSON.stringify(tiers) : null]
  );
}

// Une tentative d'achat = la séquence de checkout.ts, requête pour requête.
// MODE "avant" : la séquence historique (lecture, puis écriture d'une valeur lue).
// MODE "apres" : l'appel unique à reserve_tickets (cf. supabase_setup.sql section 25).
async function acheter({ eventId, tier, quantity, tiers, mode }) {
  if (mode === "apres") {
    const { rows: [r] } = await q(`SELECT ok, reason FROM reserve_tickets($1, $2, $3)`,
      [eventId, quantity, JSON.stringify([{ tier, quantity }])]);
    if (!r.ok) return r.reason === "palier" ? "refusé-palier" : "refusé-global";
  } else {
    const { rows: [ev] } = await q(`SELECT tickets_sold, total_tickets FROM events WHERE id = $1`, [eventId]);
    if (!ev) return "introuvable";
    const ticketsSold = Number(ev.tickets_sold || 0);
    const totalTickets = Number(ev.total_tickets || 0);
    const { rows: reserved } = await q(
      `UPDATE events SET tickets_sold = $1 WHERE id = $2 AND tickets_sold <= $3 RETURNING tickets_sold`,
      [ticketsSold + quantity, eventId, totalTickets - quantity]);
    if (reserved.length === 0) return "refusé-global";
    if (tiers) {
      const tierDef = tiers.find((t) => t.name.toLowerCase() === tier);
      if (tierDef && Number(tierDef.total) > 0) {
        const { rows: [c] } = await q(
          `SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND tier = $2
             AND transaction_ref NOT LIKE 'PENDING-%' AND transaction_ref NOT LIKE 'FAILED-%'`,
          [eventId, tier]);
        if (c.n + quantity > Number(tierDef.total)) {
          await q(`UPDATE events SET tickets_sold = $1 WHERE id = $2`, [ticketsSold, eventId]);
          return "refusé-palier";
        }
      }
    }
  }

  const lignes = [];
  for (let i = 0; i < quantity; i++) {
    const id = `tkt-${Math.random().toString(36).slice(2)}-${Date.now()}-${i}`;
    lignes.push(q(
      `INSERT INTO tickets (id, event_id, event_title, event_date, event_time, event_venue,
         buyer_id, buyer_email, tier, price_paid, qr_code_data, transaction_ref, quantity)
       VALUES ($1,$2,'Concert de charge','2030-01-01','20:00','Palais','usr-x','x@y.ci',$3,5000,$4,$5,1)`,
      [id, eventId, tier, `qr-${id}`, `TX-${id}`]));
  }
  await Promise.all(lignes);
  return "vendu";
}

function resume(resultats) {
  const c = {};
  for (const r of resultats) c[r] = (c[r] || 0) + 1;
  return c;
}

async function scenario({ nom, total, tiers, acheteurs, quantity, tier, mode }) {
  const eventId = `evt-charge-${Math.random().toString(36).slice(2, 8)}`;
  await prepareEvent({ id: eventId, total, tiers });

  const t0 = Date.now();
  const res = await Promise.all(
    Array.from({ length: acheteurs }, () => acheter({ eventId, tier, quantity, tiers, mode }).catch((e) => `erreur:${e.code || e.message}`))
  );
  const ms = Date.now() - t0;

  const { rows: [etat] } = await q(
    `SELECT e.tickets_sold, e.total_tickets,
            (SELECT count(*)::int FROM tickets t WHERE t.event_id = e.id) AS billets_reels
     FROM events e WHERE e.id = $1`, [eventId]);

  const places = total;
  const reels = Number(etat.billets_reels);
  const compteur = Number(etat.tickets_sold);

  console.log(`\n### ${nom}`);
  console.log(`    ${acheteurs} acheteurs simultanés × ${quantity} place(s) — ${places} places en vente — ${ms} ms`);
  console.log(`    réponses : ${JSON.stringify(resume(res))}`);
  console.log(`    compteur "tickets_sold" en base : ${compteur}`);
  console.log(`    BILLETS RÉELLEMENT ÉMIS         : ${reels}`);
  if (reels > places) {
    console.log(`    ❌ SURVENTE : ${reels - places} billet(s) de trop — des porteurs de billet valide resteront à la porte`);
  } else {
    console.log(`    ✅ aucune survente (${reels}/${places})`);
  }
  if (compteur !== reels) {
    console.log(`    ⚠️  compteur faux : affiche ${compteur} pour ${reels} billets émis (écart ${reels - compteur})`);
  }

  if (tiers) {
    const { rows: parTier } = await q(
      `SELECT tier, count(*)::int AS n FROM tickets WHERE event_id = $1 GROUP BY tier`, [eventId]);
    for (const t of parTier) {
      const def = tiers.find((x) => x.name.toLowerCase() === t.tier);
      const max = def ? Number(def.total) : null;
      const ko = max !== null && t.n > max;
      console.log(`    palier ${t.tier} : ${t.n}${max !== null ? "/" + max : ""} ${ko ? "❌ SURVENTE DU PALIER" : "✅"}`);
    }
  }
  return { reels, places, compteur };
}

// Le cron d'expiration des paniers abandonnés tourne PENDANT que les ventes continuent :
// il rend des places au même compteur que celui qu'incrémentent les acheteurs. Deux
// écritures sur la même ligne, donc la même course que ci-dessus.
async function scenarioCron({ mode }) {
  const eventId = `evt-cron-${Math.random().toString(36).slice(2, 8)}`;
  await prepareEvent({ id: eventId, total: 200 });
  // 40 paniers abandonnés que le cron va expirer
  await q(`UPDATE events SET tickets_sold = 40 WHERE id = $1`, [eventId]);

  const rendreUnePlace = async () => {
    if (mode === "apres") {
      await q(`SELECT release_tickets($1, 1, $2)`, [eventId, JSON.stringify([{ tier: "standard", quantity: 1 }])]);
    } else {
      const { rows: [e] } = await q(`SELECT tickets_sold FROM events WHERE id = $1`, [eventId]);
      await q(`UPDATE events SET tickets_sold = $1 WHERE id = $2`, [Math.max(0, Number(e.tickets_sold) - 1), eventId]);
    }
  };

  const t0 = Date.now();
  await Promise.all([
    ...Array.from({ length: 40 }, () => rendreUnePlace()),
    ...Array.from({ length: 60 }, () => acheter({ eventId, tier: "standard", quantity: 1, mode })),
  ]);
  const ms = Date.now() - t0;

  const { rows: [etat] } = await q(`SELECT tickets_sold FROM events WHERE id = $1`, [eventId]);
  const attendu = 40 - 40 + 60; // 40 places rendues, 60 vendues
  const obtenu = Number(etat.tickets_sold);
  console.log(`\n### Cron d'expiration concurrent aux ventes`);
  console.log(`    40 places rendues + 60 ventes en simultané — ${ms} ms`);
  console.log(`    compteur attendu : ${attendu} — obtenu : ${obtenu}`);
  console.log(obtenu === attendu
    ? `    ✅ aucune écriture perdue`
    : `    ❌ ${Math.abs(attendu - obtenu)} place(s) perdue(s) — le stock dérive à chaque passage du cron`);
  return { reels: 0, places: 1, exact: obtenu === attendu };
}

// Salle d'attente : la promotion des visiteurs en file doit respecter la capacité même si
// tout le monde interroge son statut en même temps (c'est le cas : le navigateur poll).
async function scenarioSalleAttente() {
  const eventId = `evt-file-${Math.random().toString(36).slice(2, 8)}`;
  await prepareEvent({ id: eventId, total: 1000 });
  await q(`DELETE FROM waiting_room_entries WHERE event_id = $1`, [eventId]);
  const capacite = 25;
  for (let i = 0; i < 300; i++) {
    await q(`INSERT INTO waiting_room_entries (id, event_id, user_id, status) VALUES ($1,$2,$3,'waiting')`,
      [`wr-${eventId}-${i}`, eventId, `usr-${i}`]);
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 300 }, () => q(`SELECT advance_waiting_room($1, $2, 10)`, [eventId, capacite])));
  const ms = Date.now() - t0;
  const { rows: [c] } = await q(`SELECT count(*)::int AS n FROM waiting_room_entries WHERE event_id = $1 AND status = 'active'`, [eventId]);
  console.log(`\n### Salle d'attente — 300 visiteurs interrogeant leur statut simultanément`);
  console.log(`    (ce scénario appelle toujours la fonction déployée : il ne suit pas MODE)`);
  console.log(`    capacité configurée : ${capacite} — sessions actives obtenues : ${c.n} — ${ms} ms`);
  console.log(Number(c.n) <= capacite
    ? `    ✅ capacité respectée (aucune promotion en trop)`
    : `    ❌ ${c.n - capacite} visiteur(s) admis au-delà de la capacité`);
  return { reels: 0, places: 1, exact: Number(c.n) <= capacite };
}

const mode = process.env.MODE === "avant" ? "avant" : "apres";
console.log(`\n=== Campagne de charge — séquence "${mode === "avant" ? "avant correctif" : "après correctif"}" ===`);
const resultats = [];
resultats.push(await scenario({ mode, nom: "Vente à guichets fermés (capacité globale)", total: 100, acheteurs: 200, quantity: 1, tier: "standard" }));
resultats.push(await scenario({ mode, nom: "Commandes groupées (3 places par acheteur)", total: 60, acheteurs: 60, quantity: 3, tier: "standard" }));
resultats.push(await scenario({
  mode, nom: "Paliers tarifaires (VIP limité)", total: 500, acheteurs: 80, quantity: 1, tier: "vip",
  tiers: [{ name: "VIP", price: 25000, total: 20 }, { name: "Standard", price: 5000, total: 480 }]
}));

resultats.push(await scenarioCron({ mode }));
resultats.push(await scenarioSalleAttente());

await pool.end();
const survente = resultats.some((r) => r.reels > r.places || r.exact === false);
process.exit(survente ? 1 : 0);
