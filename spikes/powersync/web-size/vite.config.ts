import { defineConfig } from 'vite'

// Mirrors the official PowerSync Vite template, minus React and vite-plugin-wasm
// (Vite resolves the wa-sqlite `new URL('*.wasm', import.meta.url)` assets itself).
export default defineConfig({
  root: __dirname,
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite', '@powersync/web'] },
})
