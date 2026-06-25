import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
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
          // Don't cache payment SDK — always fresh
          globIgnores: ['**/paiementpro*'],
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
