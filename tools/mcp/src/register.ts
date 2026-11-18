/**
 * Lets Node run the shared TypeScript domain code directly (no build step).
 * The web sources use bundler-style imports (`./schema`, `@/domain/...`);
 * Node's ESM resolver needs a file extension, so this hook retries
 * extensionless relative imports with `.ts` and maps `@/` to `src/`.
 * Loaded with `node --import ./tools/mcp/src/register.ts`.
 */
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const srcRoot = pathToFileURL(
  path.resolve(import.meta.dirname, '../../../src') + '/',
).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = specifier
    if (target.startsWith('@/')) target = new URL(target.slice(2), srcRoot).href
    const relative =
      target.startsWith('./') || target.startsWith('../') || target.startsWith('file:')
    if (relative && !/\.[cm]?[jt]sx?$|\.json$/.test(target)) {
      try {
        return nextResolve(`${target}.ts`, context)
      } catch {
        // Fall through to the default resolution and its error message.
      }
    }
    return nextResolve(target, context)
  },
})
