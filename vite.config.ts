import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  plugins: [
    // The router plugin must come before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'finance-icon.svg',
        'finance-icon-192.png',
        'finance-icon-512.png',
      ],
      manifest: {
        name: 'Finance',
        short_name: 'Finance',
        description: 'A monthly budget planner that works offline.',
        theme_color: '#596fff',
        background_color: '#f3f5fb',
        display: 'standalone',
        start_url: '/',
        lang: 'en',
        categories: ['finance', 'productivity'],
        icons: [
          {
            src: '/finance-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/finance-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/finance-icon-512.png',
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
    // spikes/ holds throwaway experiments with their own dependencies.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.claude/**', 'spikes/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
