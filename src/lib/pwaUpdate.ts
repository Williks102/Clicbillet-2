import { registerSW } from "virtual:pwa-register";

// Une PWA installée (icône sur l'écran d'accueil) peut rester ouverte plusieurs jours sans
// jamais faire de navigation complète — le navigateur ne revérifie alors jamais /sw.js de
// lui-même, et les mises à jour déployées n'apparaissent jamais dans l'app installée (elles
// restent visibles uniquement dans un onglet de navigateur classique, rechargé à chaque fois).
// On force ce contrôle nous-mêmes à intervalles réguliers.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

// Avec registerType "autoUpdate", vite-plugin-pwa recharge par défaut la page dès que la
// nouvelle version s'active — y compris en plein paiement (ex : le client bascule sur son
// app SMS pour lire le code OTP Mobile Money, revient, et perd sa commande en cours). On
// diffère donc le rechargement jusqu'à ce que l'onglet ne soit plus sous les yeux de
// personne (visibilitychange → hidden), jamais pendant une session active.
function reloadWhenHidden() {
  if (document.visibilityState === "hidden") {
    window.location.reload();
    return;
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.location.reload();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
}

registerSW({
  immediate: true,
  onNeedReload: reloadWhenHidden,
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
