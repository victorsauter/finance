// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupStore } from '../src/backup.ts'
import { buildTools, callTool, createFinanceServer } from '../src/server.ts'
import { FEB_SAVING, FakeDocumentStore, temporaryDirectory } from './support.ts'

const READ_TOOLS = [
  'list_months', 'get_budget', 'list_categories', 'list_transactions', 'list_uncategorized',
  'merchant_summary', 'spending_by_category', 'monthly_totals', 'list_backups',
]
const WRITE_TOOLS = [
  'set_transaction_category', 'categorize_by_description', 'set_transaction_kind', 'set_kind_by_description',
  'set_planned_amount', 'add_expense_item', 'rename_item', 'delete_item', 'restore_backup',
]

describe('MCP server', () => {
  let temp: Awaited<ReturnType<typeof temporaryDirectory>>
  let store: FakeDocumentStore
  let backups: BackupStore
  beforeEach(async () => {
    temp = await temporaryDirectory()
    store = new FakeDocumentStore()
    backups = new BackupStore(temp.directory)
  })
  afterEach(() => temp.cleanup())

  async function connect(readOnly: boolean) {
    const server = createFinanceServer({ store, backups, readOnly })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)
    return client
  }

  it('lists every tool with the right annotations over MCP', async () => {
    const client = await connect(false)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].toSorted())
    for (const tool of tools) {
      const write = WRITE_TOOLS.includes(tool.name)
      expect(tool.annotations?.readOnlyHint).toBe(!write)
      if (write) {
        expect(tool.annotations?.destructiveHint).toBe(true)
        expect(tool.inputSchema.properties).toHaveProperty('dry_run')
      }
    }
    const result = await client.callTool({ name: 'list_categories', arguments: { month: '2026-02' } })
    const text = (result.content as Array<{ text: string }>)[0]!.text
    expect(JSON.parse(text).categories).toHaveLength(2)
    await client.close()
  })

  it('does not register write tools in read-only mode', async () => {
    const client = await connect(true)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).toSorted()).toEqual(READ_TOOLS.toSorted())
    const refused = await client.callTool({ name: 'set_transaction_kind', arguments: { ids: ['x'], kind: 'transfer' } })
    expect(refused.isError).toBe(true)
    await client.close()
    expect(buildTools({ store, backups, readOnly: true }).some((tool) => tool.write)).toBe(false)
  })

  it('runs a write tool as a dry run by default and reports errors as tool errors', async () => {
    const tools = Object.fromEntries(buildTools({ store, backups, readOnly: false }).map((tool) => [tool.name, tool]))
    const dry = await callTool(tools.set_transaction_category!, {
      ids: ['00000000-0000-4000-8000-000000000202'], categoryId: FEB_SAVING,
    })
    expect(dry.isError).toBeUndefined()
    expect(JSON.parse((dry.content[0] as { text: string }).text)).toMatchObject({ dryRun: true, changed: 1 })
    expect(store.writes).toHaveLength(0)

    const real = await callTool(tools.set_transaction_category!, {
      ids: ['00000000-0000-4000-8000-000000000202'], categoryId: FEB_SAVING, dry_run: false,
    })
    expect(JSON.parse((real.content[0] as { text: string }).text)).toMatchObject({ saved: true, revision: 8 })
    expect(store.writes).toHaveLength(1)

    const unknown = await callTool(tools.set_transaction_kind!, { ids: ['missing'], kind: 'transfer', dry_run: false })
    expect(unknown).toMatchObject({ isError: true })
    expect((unknown.content[0] as { text: string }).text).toMatch(/Unknown transaction id/)

    const listed = await callTool(tools.list_backups!, {})
    expect(JSON.parse((listed.content[0] as { text: string }).text).backups).toHaveLength(1)
  })
})
