import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'budget-icon.svg',
        'budget-icon-192.png',
        'budget-icon-512.png',
      ],
      manifest: {
        name: 'Mon Budget',
        short_name: 'Budget',
        description: 'Planificateur de budget mensuel, disponible hors connexion.',
        theme_color: '#596fff',
        background_color: '#f3f5fb',
        display: 'standalone',
        start_url: '/',
        lang: 'fr',
        categories: ['finance', 'productivity'],
        icons: [
          {
            src: '/budget-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/budget-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/budget-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable any',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
