/**
 * Entry point: `login`, `logout`, `status`, `start` (the stdio MCP server).
 * Run through the npm scripts, which load register.ts first:
 *   node --import ./tools/mcp/src/register.ts tools/mcp/src/cli.ts <command>
 * stdout is reserved for the MCP protocol in `start`; everything else is stderr.
 */
import { createInterface } from 'node:readline/promises'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { LOGIN_HINT, NotSignedInError, createNodeClient, login, logout, restoreSession } from './auth.ts'
import { BackupStore } from './backup.ts'
import { backupDirectory, isReadOnly, keychainService, loadSupabaseConfig } from './config.ts'
import { Keychain } from './keychain.ts'
import { log } from './log.ts'
import { createFinanceServer } from './server.ts'
import { createSupabaseStore } from './store.ts'

async function start() {
  const client = createNodeClient(loadSupabaseConfig(), { autoRefreshToken: true })
  const keychain = new Keychain(keychainService())
  const { userId } = await restoreSession(client, keychain)
  const readOnly = isReadOnly()
  const server = createFinanceServer({
    store: createSupabaseStore(client, userId),
    backups: new BackupStore(backupDirectory()),
    readOnly,
  })
  await server.connect(new StdioServerTransport())
  log(`Ready${readOnly ? ' (read-only)' : ''}.`)
}

async function runLogin() {
  const client = createNodeClient(loadSupabaseConfig(), { autoRefreshToken: false })
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const { userId } = await login(client, new Keychain(keychainService()), {
      ask: (question) => prompt.question(question),
    })
    log(`Signed in (user ${userId}). The session is stored in the macOS Keychain only.`)
  } finally {
    prompt.close()
  }
}

async function runLogout() {
  const client = createNodeClient(loadSupabaseConfig(), { autoRefreshToken: false })
  const removed = await logout(client, new Keychain(keychainService()))
  log(removed ? 'Signed out; the Keychain entry was removed.' : 'No session was stored.')
}

async function runStatus() {
  const keychain = new Keychain(keychainService())
  const stored = await keychain.load()
  if (!stored) {
    log(`Not signed in. ${LOGIN_HINT}`)
    process.exitCode = 1
    return
  }
  const client = createNodeClient(loadSupabaseConfig(), { autoRefreshToken: false })
  const { userId } = await restoreSession(client, keychain)
  log(`Signed in (user ${userId}); the session is valid. Read-only: ${isReadOnly() ? 'yes' : 'no'}. Backups: ${backupDirectory()}`)
}

const commands: Record<string, () => Promise<void>> = {
  start, login: runLogin, logout: runLogout, status: runStatus,
}

const command = commands[process.argv[2] ?? '']
if (!command) {
  log('Usage: cli.ts <start|login|logout|status>')
  process.exit(2)
}

try {
  await command()
} catch (error) {
  log(error instanceof NotSignedInError ? error.message : `Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
