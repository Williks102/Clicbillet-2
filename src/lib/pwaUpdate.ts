import { registerSW } from "virtual:pwa-register";

// Une PWA installée (icône sur l'écran d'accueil) peut rester ouverte plusieurs jours sans
// jamais faire de navigation complète — le navigateur ne revérifie alors jamais /sw.js de
// lui-même, et les mises à jour déployées n'apparaissent jamais dans l'app installée (elles
// restent visibles uniquement dans un onglet de navigateur classique, rechargé à chaque fois).
// On force ce contrôle nous-mêmes à intervalles réguliers. Avec registerType "autoUpdate",
// dès qu'une mise à jour est détectée et activée, la page se recharge automatiquement.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;
    setInterval(async () => {
      if (registration.installing || !navigator.onLine) return;
      const resp = await fetch(swUrl, {
        cache: "no-store",
        headers: { cache: "no-store", "cache-control": "no-cache" },
      });
      if (resp.status === 200) await registration.update();
    }, CHECK_INTERVAL_MS);
  },
});
