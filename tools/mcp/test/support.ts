/** Synthetic test data and fakes for the MCP server tests. No network, Keychain or home folder. */
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import fixture from '../../../fixtures/domain/app-data.json' with { type: 'json' }
import type { AppData, ImportedTransaction } from '../../../src/domain/budget/models.ts'
import { parseAppData } from '../../../src/domain/budget/schema.ts'
import type { CloudWrite } from '../../../src/data/cloud/types.ts'
import type { DocumentStore } from '../src/store.ts'

export const JAN_HOUSING = '00000000-0000-4000-8000-000000000040'
export const FEB_HOUSING = '00000000-0000-4000-8000-000000000047'
export const FEB_SAVING = '00000000-0000-4000-8000-000000000050'
export const FEB_GROCERY_TX = '00000000-0000-4000-8000-000000000052'
export const FEB_REFUND_TX = '00000000-0000-4000-8000-000000000054'

let counter = 0x100
export function syntheticId() {
  counter += 1
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
}

export function transaction(overrides: Partial<ImportedTransaction>): ImportedTransaction {
  const id = overrides.id ?? syntheticId()
  return {
    id,
    provider: 'revolut-csv',
    sourceKey: `synthetic-${id}`,
    sourceReference: null,
    importBatchId: '00000000-0000-4000-8000-000000000053',
    sourceFileName: 'example-statement.csv',
    bookingDate: '2026-02-10',
    startedAt: null,
    completedAt: null,
    description: 'Example merchant',
    amountCents: -1000,
    feeCents: 0,
    balanceCents: null,
    currency: 'EUR',
    transactionType: 'CARD_PAYMENT',
    product: 'Current',
    kind: 'expense',
    categoryId: null,
    importedAt: '2026-02-11T10:00:00.000Z',
    ...overrides,
  }
}

/** The shared fixture (two months, two transactions) plus a few synthetic rows. */
export function sampleData(): AppData {
  const data = parseAppData(structuredClone(fixture.appData))
  data.importedTransactions.push(
    transaction({ id: '00000000-0000-4000-8000-000000000201', bookingDate: '2026-01-12', description: 'EXAMPLE GROCERY-STORE', amountCents: -2000 }),
    transaction({ id: '00000000-0000-4000-8000-000000000202', bookingDate: '2026-02-14', description: 'Example grocery store', amountCents: -3000, feeCents: 50 }),
    transaction({ id: '00000000-0000-4000-8000-000000000203', bookingDate: '2026-02-15', description: 'To pocket Example savings', amountCents: -10000, transactionType: 'TRANSFER', kind: 'transfer' }),
    transaction({ id: '00000000-0000-4000-8000-000000000204', bookingDate: '2026-02-16', description: 'Example travel shop', amountCents: -5000, currency: 'GBP' }),
    transaction({ id: '00000000-0000-4000-8000-000000000205', bookingDate: '2026-01-20', description: 'Example bakery', amountCents: -700, categoryId: JAN_HOUSING }),
  )
  return parseAppData(data)
}

export interface RecordedWrite {
  data: AppData
  revision: number
  mutationId: string
}

/** Mimics save_finance_document: compare-and-swap on revision, idempotent on mutation id. */
export class FakeDocumentStore implements DocumentStore {
  data: AppData | null
  revision: number
  reads = 0
  writes: RecordedWrite[] = []
  events: string[]
  private results = new Map<string, CloudWrite>()

  constructor(data: AppData | null = sampleData(), revision = 7, events: string[] = []) {
    this.data = data
    this.revision = revision
    this.events = events
  }

  async read() {
    this.reads += 1
    return this.data ? { data: structuredClone(this.data), revision: this.revision } : null
  }

  async write(data: AppData, revision: number, mutationId: string): Promise<CloudWrite> {
    this.events.push('write')
    this.writes.push({ data: structuredClone(data), revision, mutationId })
    const known = this.results.get(mutationId)
    if (known) return known
    let outcome: CloudWrite
    if (revision !== this.revision) {
      outcome = { status: 'conflict', revision: this.revision }
    } else {
      this.data = parseAppData(structuredClone(data))
      this.revision += 1
      outcome = { status: 'saved', revision: this.revision }
    }
    this.results.set(mutationId, outcome)
    return outcome
  }

  /** Simulates an edit made elsewhere (web or iPhone app). */
  bumpElsewhere() {
    this.revision += 1
  }
}

export async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'finance-mcp-test-'))
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
