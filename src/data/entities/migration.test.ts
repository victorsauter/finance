import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadJson } from '@/features/backup/download'
import type { AppData } from '@/domain/budget/models'
import { parseAppData } from '@/domain/budget/schema'
import type { EntitySnapshot } from './rows'
import { canonicalizeAppData, documentToEntities } from './convert'
import {
  documentsAreEqual,
  findFirstDifference,
  migrateDocumentToEntities,
  rollbackEntitiesToDocument,
} from './migration'
import { createSyntheticAppData } from './synthetic'
import { deepFreeze, fixtureDocument } from './test-fixtures'

/** Lets a test make the conversion back return a wrong document. */
const corruption = vi.hoisted(() => ({ enabled: false }))

vi.mock('./convert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./convert')>()
  return {
    ...actual,
    entitiesToDocument: (snapshot: EntitySnapshot) => {
      const document = actual.entitiesToDocument(snapshot)
      if (corruption.enabled) document.budgetMonths[0].incomes[0].amountCents += 1
      return document
    },
  }
})

const SEEDS = Array.from({ length: 50 }, (_, index) => index + 1)

afterEach(() => {
  corruption.enabled = false
  vi.restoreAllMocks()
})

/** The text the existing Backup page export would write for `data`. */
async function existingExport(data: AppData): Promise<string> {
  let blob: Blob | undefined
  URL.createObjectURL = vi.fn((value: Blob | MediaSource) => {
    blob = value as Blob
    return 'blob:synthetic'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadJson('finance-test.json', data)
  if (!blob) throw new Error('The export wrote nothing')
  return await blob.text()
}

/** Same value with every object's keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseKeys(child)]),
    )
  }
  return value
}

function errorCode(action: () => unknown): string | undefined {
  try {
    action()
  } catch (error) {
    return (error as { code?: string }).code
  }
  return undefined
}

describe('migrateDocumentToEntities', () => {
  it.each(SEEDS)('migrates synthetic document %i and both backups restore', (seed) => {
    const data = createSyntheticAppData(seed)
    const migration = migrateDocumentToEntities(data)

    expect(migration.snapshot).toEqual(documentToEntities(data))
    expect(parseAppData(JSON.parse(migration.backupBefore))).toEqual(data)
    expect(parseAppData(JSON.parse(migration.backupAfter))).toEqual(data)
    // A canonical document comes back byte for byte.
    expect(migration.backupAfter).toBe(migration.backupBefore)
  })

  it('writes backupBefore exactly like the existing backup export', async () => {
    for (const data of [fixtureDocument(), createSyntheticAppData(9)]) {
      const migration = migrateDocumentToEntities(data)
      expect(migration.backupBefore).toBe(await existingExport(data))
    }
  })

  it('keeps the original order in backupBefore and the canonical one in backupAfter', async () => {
    const data = createSyntheticAppData(4, { shuffle: true })
    const migration = migrateDocumentToEntities(data)

    expect(migration.backupBefore).toBe(await existingExport(data))
    expect(JSON.parse(migration.backupBefore)).toEqual(data)
    expect(parseAppData(JSON.parse(migration.backupAfter))).toEqual(
      canonicalizeAppData(data),
    )
  })

  it('rejects an invalid document before converting it', () => {
    const data = fixtureDocument()
    data.settings.activeBudgetMonthId = null
    expect(errorCode(() => migrateDocumentToEntities(data))).toBe('invalid-document')
  })

  it('rejects a document that cannot round-trip (gaps in sortOrder)', () => {
    const data = fixtureDocument()
    data.budgetMonths[0].incomes[1].sortOrder = 5
    expect(() => parseAppData(data)).not.toThrow()

    expect(errorCode(() => migrateDocumentToEntities(data))).toBe('round-trip-mismatch')
    expect(() => migrateDocumentToEntities(data)).toThrow(
      /budgetMonths\[0\]\.incomes\[1\]\.sortOrder/,
    )
  })

  it('detects a conversion that returns a different document', () => {
    const data = fixtureDocument()
    expect(() => migrateDocumentToEntities(data)).not.toThrow()

    corruption.enabled = true
    expect(errorCode(() => migrateDocumentToEntities(data))).toBe('round-trip-mismatch')
    expect(() => migrateDocumentToEntities(data)).toThrow(
      /budgetMonths\[0\]\.incomes\[0\]\.amountCents/,
    )
  })

  it('does not mutate a frozen document', () => {
    const data = deepFreeze(createSyntheticAppData(8, { shuffle: true }))
    expect(() => migrateDocumentToEntities(data)).not.toThrow()
  })
})

describe('rollbackEntitiesToDocument', () => {
  it.each(SEEDS)('rolls synthetic snapshot %i back to its document', (seed) => {
    const data = createSyntheticAppData(seed)
    const { snapshot } = migrateDocumentToEntities(data)
    const rollback = rollbackEntitiesToDocument(snapshot)

    expect(rollback.document).toEqual(data)
    expect(JSON.parse(rollback.backupBefore)).toEqual(snapshot)
    expect(rollback.backupBefore).toBe(JSON.stringify(snapshot, null, 2))
    expect(parseAppData(JSON.parse(rollback.backupAfter))).toEqual(data)
    expect(rollback.backupAfter).toBe(JSON.stringify(rollback.document, null, 2))
  })

  it('writes backupAfter like the existing backup export', async () => {
    const { snapshot } = migrateDocumentToEntities(fixtureDocument())
    const rollback = rollbackEntitiesToDocument(snapshot)
    expect(rollback.backupAfter).toBe(await existingExport(rollback.document))
  })

  it('applies soft deletes while rolling back', () => {
    const { snapshot } = migrateDocumentToEntities(fixtureDocument())
    const edited = structuredClone(snapshot)
    edited.months[1].deletedAt = '2025-03-01T00:00:00.000Z'
    const rollback = rollbackEntitiesToDocument(edited)
    expect(rollback.document.budgetMonths).toHaveLength(1)
    expect(rollback.document.settings.activeBudgetMonthId).toBe(
      rollback.document.budgetMonths[0].id,
    )
  })

  it('rejects a snapshot with the wrong shape', () => {
    const { snapshot } = migrateDocumentToEntities(fixtureDocument())
    const broken = structuredClone(snapshot)
    broken.incomes[0].id = 'not-a-uuid'
    expect(errorCode(() => rollbackEntitiesToDocument(broken))).toBe('invalid-snapshot')
  })

  it('rejects a snapshot without a live month', () => {
    const { snapshot } = migrateDocumentToEntities(fixtureDocument())
    const empty = { ...structuredClone(snapshot), months: [] }
    expect(errorCode(() => rollbackEntitiesToDocument(empty))).toBe('no-live-month')
  })
})

describe('document comparison helper', () => {
  it('finds no difference between equal documents, whatever the key order', () => {
    const data = fixtureDocument()
    const reordered = reverseKeys(data) as AppData
    expect(findFirstDifference(data, reordered)).toBeNull()
    expect(documentsAreEqual(data, structuredClone(data))).toBe(true)
  })

  it('reports the path of the first difference', () => {
    const data = fixtureDocument()

    const amount = structuredClone(data)
    amount.budgetMonths[1].accounts[0].plannedTransferCents += 1
    expect(findFirstDifference(data, amount)).toBe(
      '$.budgetMonths[1].accounts[0].plannedTransferCents',
    )

    const shorter = structuredClone(data)
    shorter.importedTransactions.pop()
    expect(findFirstDifference(data, shorter)).toBe('$.importedTransactions.length')

    const nullable = structuredClone(data)
    nullable.importedTransactions[0].categoryId = null
    expect(findFirstDifference(data, nullable)).toBe(
      '$.importedTransactions[0].categoryId',
    )

    const timestamp = structuredClone(data)
    timestamp.budgetMonths[0].updatedAt = '2025-01-20T10:30:00.124Z'
    expect(documentsAreEqual(data, timestamp)).toBe(false)

    const order = structuredClone(data)
    order.budgetMonths.reverse()
    expect(documentsAreEqual(data, order)).toBe(false)
  })

  it('treats a missing key and an array/object mix-up as differences', () => {
    expect(findFirstDifference({ a: 1 }, {})).toBe('$.a')
    expect(findFirstDifference([], {})).toBe('$')
    expect(findFirstDifference(null, 0)).toBe('$')
    expect(findFirstDifference(NaN, NaN)).toBeNull()
  })
})
