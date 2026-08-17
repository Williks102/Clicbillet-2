import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Les commentaires HTML de index.html sont écrits pour les développeurs, mais un fichier
// statique les livre tels quels à chaque visiteur : un scan externe a ainsi relevé un chemin
// serveur (`server/lib/socialPreview.ts`) directement dans la réponse HTTP de la page d'accueil
// — un attaquant y lit gratuitement la structure du dépôt (CWE-200, Path Disclosure).
// Plutôt que d'appauvrir le source, on le laisse commenté et on retire les commentaires du
// HTML produit. `enforce: "post"` fait passer ce plugin en dernier, donc après les balises
// injectées par vite-plugin-pwa : leurs propres commentaires disparaissent aussi.
// Les commentaires conditionnels IE (`<!--[if ...]>`) sont préservés : ce sont des
// instructions, pas de la documentation. Le HTML de /e/:id est construit à partir du fichier
// buildé (cf. server.ts), il hérite donc du nettoyage.
function stripHtmlComments() {
  return {
    name: 'clicbillet-strip-html-comments',
    apply: 'build' as const,
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      return html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // Le script auto-injecté par défaut ('script') se contente d'un
        // navigator.serviceWorker.register() one-shot, sans jamais revérifier ni recharger
        // la page : une PWA installée restée ouverte plusieurs jours ne voit alors jamais
        // les nouvelles versions déployées. On enregistre nous-mêmes via virtual:pwa-register
        // (cf. src/lib/pwaUpdate.ts) pour un vrai contrôle périodique + rechargement auto.
        injectRegister: false,
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'ClicBillet – Billetterie Ivoirienne',
          short_name: 'ClicBillet',
          description: 'Achetez vos billets de concerts, festivals et matchs en Côte d\'Ivoire avec Orange Money, MTN, Wave et plus.',
          theme_color: '#ea580c',
          background_color: '#f9fafb',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          orientation: 'portrait-primary',
          lang: 'fr',
          categories: ['entertainment', 'lifestyle'],
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          runtimeCaching: [
            {
              // Events list: network-first, fallback to cache (5 min TTL)
              urlPattern: /^\/api\/events$/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-events',
                networkTimeoutSeconds: 5,
                expiration: {
                  maxEntries: 1,
                  maxAgeSeconds: 5 * 60,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Organizer/admin API: network-only (never stale data for ops)
              urlPattern: /^\/api\/(organizer|admin|auth)\//,
              handler: 'NetworkOnly',
            },
            {
              // Event banner images: stale-while-revalidate (fast display)
              urlPattern: /\.(png|jpe?g|webp|gif)$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'images',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          // Enable SW in dev for testing — set to false to speed up HMR
          enabled: false,
        },
      }),
      stripHtmlComments(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
