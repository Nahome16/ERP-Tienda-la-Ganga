import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // El service worker solo guarda el armazón de la app (HTML, JS, CSS, imágenes)
      // para que abra sin internet. Las respuestas de /api NUNCA se cachean aquí (salvo /api/v1/media):
      // los datos del POS viven en IndexedDB y los gestiona la propia app.
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['logo-tienda-la-ganga.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'La Ganga — Punto de venta',
        short_name: 'La Ganga POS',
        description: 'Punto de venta de Tienda La Ganga. Funciona también sin conexión.',
        lang: 'es',
        dir: 'ltr',
        start_url: '/#pos',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f8f2e8',
        theme_color: '#153a45',
        categories: ['business', 'shopping'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Única excepción en /api: las fotos de productos (/api/v1/media/…). Un mismo nombre
        // de archivo nunca cambia, así que CacheFirst es seguro y deja verlas sin internet.
        // El resto de la API (datos, sesión, ventas) NO pasa por el service worker.
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/v1/media/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  publicDir: '../../../docs/assets',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5185',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': 'http://127.0.0.1:5185',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
