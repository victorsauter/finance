// Builds the throwaway web-size/ entry with Vite (the repository's own Vite,
// from the root node_modules) and prints raw and gzip sizes: everything the
// build emits, and the subset Chromium actually fetched at runtime with
// vfs: 'auto' (measured once by serving dist/ and reading the server log; the
// list below matches file name prefixes from that measurement).
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { REPO_ROOT, SPIKE_DIR } from '../src/env.ts'

const RUNTIME_PREFIXES = ['index-', 'worker-', 'FacadeVFS-', 'MemoryVFS-', 'SimpleOpfsFileSystem-', 'wa-sqlite-']

execFileSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'vite'), ['build', '--config', 'web-size/vite.config.ts'], {
  cwd: SPIKE_DIR,
  stdio: 'ignore',
})
const assets = path.join(SPIKE_DIR, 'web-size', 'dist', 'assets')
let raw = 0
let gzip = 0
const runtime = new Map<string, { raw: number; gzip: number }>()
for (const name of readdirSync(assets)) {
  const bytes = readFileSync(path.join(assets, name))
  const gz = gzipSync(bytes, { level: 9 }).length
  raw += bytes.length
  gzip += gz
  const prefix = RUNTIME_PREFIXES.find((p) => name.startsWith(p) && !name.startsWith('wa-sqlite-async'))
  // Keep one file per prefix: the build emits two copies of some chunks (one per worker graph).
  if (prefix && (prefix !== 'wa-sqlite-' || name.endsWith('.wasm') || !runtime.has('wa-sqlite-js'))) {
    const key = prefix === 'wa-sqlite-' ? (name.endsWith('.wasm') ? 'wa-sqlite-wasm' : 'wa-sqlite-js') : prefix
    if (!runtime.has(key)) runtime.set(key, { raw: bytes.length, gzip: gz })
  }
}
const kib = (n: number) => `${(n / 1024).toFixed(0)} KiB`
console.log(`Emitted by the build: ${kib(raw)} raw, ${kib(gzip)} gzip (all VFS variants, async and encryption builds)`)
let rr = 0
let rg = 0
for (const [key, size] of runtime) {
  rr += size.raw
  rg += size.gzip
  console.log(`  runtime ${key.padEnd(24)} ${kib(size.raw).padStart(9)} ${kib(size.gzip).padStart(9)} gzip`)
}
console.log(`Fetched at runtime (Chromium, vfs 'auto'): ${kib(rr)} raw, ${kib(rg)} gzip`)
