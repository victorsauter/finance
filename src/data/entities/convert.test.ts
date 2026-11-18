import { describe, expect, it } from 'vitest'
import { MAX_AMOUNT_CENTS } from '@/domain/budget/money'
import type { AppData } from '@/domain/budget/models'
import { parseAppData } from '@/domain/budget/schema'
import {
  canonicalizeAppData,
  documentToEntities,
  EntityConversionError,
  entitiesToDocument,
} from './convert'
import type { EntitySnapshot } from './rows'
import { entitySnapshotSchema } from './rows'
import { createSyntheticAppData } from './synthetic'
import { deepFreeze, fixtureDocument, id, transaction } from './test-fixtures'

const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1)

function clone<T>(value: T): T {
  return structuredClone(value)
}

function roundTrip(data: AppData): AppData {
  return entitiesToDocument(documentToEntities(data))
}

function fixtureSnapshot(): EntitySnapshot {
  return documentToEntities(fixtureDocument())
}

function markDeleted<T extends { id: string; deletedAt: string | null }>(
  rows: T[],
  rowId: string,
) {
  const row = rows.find((candidate) => candidate.id === rowId)
  if (!row) throw new Error(`No row ${rowId}`)
  row.deletedAt = '2025-03-01T00:00:00.000Z'
}

function thrownCode(action: () => unknown): string | undefined {
  try {
    action()
  } catch (error) {
    if (error instanceof EntityConversionError) return error.code
    throw error
  }
  return undefined
}

describe('synthetic documents', () => {
  it('are valid, deterministic and different per seed', () => {
    for (const seed of SEEDS) {
      const data = createSyntheticAppData(seed)
      expect(() => parseAppData(data)).not.toThrow()
      expect(createSyntheticAppData(seed)).toEqual(data)
    }
    expect(createSyntheticAppData(1)).not.toEqual(createSyntheticAppData(2))
  })

  it('stay valid when shuffled or sized by options', () => {
    for (const seed of SEEDS) {
      expect(() =>
        parseAppData(createSyntheticAppData(seed, { shuffle: true })),
      ).not.toThrow()
    }
    const big = createSyntheticAppData(7, {
      monthCount: 14,
      transactionsPerMonth: 12,
    })
    expect(big.budgetMonths).toHaveLength(14)
    expect(() => parseAppData(big)).not.toThrow()
  })
})

describe('canonicalizeAppData', () => {
  it('sorts months, lists and transactions and changes nothing else', () => {
    const data = fixtureDocument()
    const [january, february] = data.budgetMonths
    // Gaps in sortOrder must stay untouched.
    january.incomes[0].sortOrder = 5
    january.incomes[1].sortOrder = 2
    january.expenseCategories.reverse()
    january.expenseCategories[1].items.reverse()
    data.budgetMonths = [february, january]
    data.importedTransactions.reverse()

    const canonical = canonicalizeAppData(data)

    expect(canonical.budgetMonths.map((month) => month.id)).toEqual([id(1), id(2)])
    expect(canonical.budgetMonths[0].incomes.map((row) => row.id)).toEqual([
      id(12),
      id(11),
    ])
    expect(canonical.budgetMonths[0].incomes.map((row) => row.sortOrder)).toEqual([2, 5])
    expect(
      canonical.budgetMonths[0].expenseCategories.map((row) => row.id),
    ).toEqual([id(31), id(32)])
    expect(
      canonical.budgetMonths[0].expenseCategories[0].items.map((row) => row.id),
    ).toEqual([id(41), id(42)])
    expect(canonical.importedTransactions.map((row) => row.id)).toEqual([
      id(901),
      id(902),
      id(903),
    ])
    expect(canonical.settings).toEqual(data.settings)
    expect(canonical.budgetMonths[0].updatedAt).toBe(january.updatedAt)
  })

  it('breaks ties by id and is idempotent', () => {
    const data = fixtureDocument()
    data.budgetMonths[0].accounts[0].sortOrder = 0
    data.budgetMonths[0].accounts[1].sortOrder = 0
    data.budgetMonths[0].accounts.reverse()
    data.importedTransactions[1].bookingDate = '2025-01-10'
    data.importedTransactions.reverse()

    const canonical = canonicalizeAppData(data)

    expect(canonical.budgetMonths[0].accounts.map((row) => row.id)).toEqual([
      id(21),
      id(22),
    ])
    expect(canonical.importedTransactions.map((row) => row.id).slice(0, 2)).toEqual([
      id(901),
      id(902),
    ])
    expect(canonicalizeAppData(canonical)).toEqual(canonical)
  })

  it('returns a copy and never mutates its input', () => {
    const data = deepFreeze(createSyntheticAppData(3, { shuffle: true }))
    const canonical = canonicalizeAppData(data)
    expect(canonical).not.toBe(data)
    expect(canonical.budgetMonths[0]).not.toBe(data.budgetMonths[0])
  })
})

describe('document to entities and back', () => {
  it.each(SEEDS)('round-trips synthetic document %i to its canonical form', (seed) => {
    const data = createSyntheticAppData(seed)
    expect(roundTrip(data)).toEqual(canonicalizeAppData(data))
  })

  it.each(SEEDS)('round-trips shuffled synthetic document %i', (seed) => {
    const data = createSyntheticAppData(seed, { shuffle: true })
    expect(roundTrip(data)).toEqual(canonicalizeAppData(data))
    expect(documentToEntities(data)).toEqual(
      documentToEntities(canonicalizeAppData(data)),
    )
  })

  it('actually shuffles when asked (the shuffled case is not trivially canonical)', () => {
    const differing = SEEDS.filter((seed) => {
      const shuffled = createSyntheticAppData(seed, { shuffle: true })
      return (
        JSON.stringify(shuffled) !==
        JSON.stringify(canonicalizeAppData(shuffled))
      )
    })
    expect(differing.length).toBeGreaterThan(40)
  })

  it('round-trips a canonical document exactly, with sortOrder and timestamps', () => {
    const data = fixtureDocument()
    const rebuilt = roundTrip(data)
    expect(rebuilt).toEqual(data)
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(data))
  })

  it('round-trips one empty month', () => {
    const data: AppData = {
      schemaVersion: 2,
      settings: { activeBudgetMonthId: id(1) },
      budgetMonths: [
        {
          id: id(1),
          year: 2025,
          month: 6,
          name: 'Synthetic empty month',
          incomes: [],
          accounts: [],
          expenseCategories: [],
          createdAt: '2025-06-01T00:00:00.000Z',
          updatedAt: '2025-06-01T00:00:00.000Z',
        },
      ],
      importedTransactions: [],
    }
    expect(roundTrip(data)).toEqual(data)
    const snapshot = documentToEntities(data)
    expect(snapshot.months).toHaveLength(1)
    expect(snapshot.incomes).toHaveLength(0)
    expect(snapshot.settings.updatedAt).toBe('2025-06-01T00:00:00.000Z')
  })

  it('round-trips a document without transactions', () => {
    const data = { ...fixtureDocument(), importedTransactions: [] }
    expect(roundTrip(data)).toEqual(data)
  })

  it('round-trips maximum amounts', () => {
    const data = fixtureDocument()
    const january = data.budgetMonths[0]
    january.incomes[0].amountCents = MAX_AMOUNT_CENTS
    january.accounts[0].plannedTransferCents = MAX_AMOUNT_CENTS
    january.expenseCategories[0].items[0].amountCents = MAX_AMOUNT_CENTS
    data.importedTransactions[0] = {
      ...data.importedTransactions[0],
      amountCents: -MAX_AMOUNT_CENTS * 10,
      feeCents: MAX_AMOUNT_CENTS,
      balanceCents: Number.MAX_SAFE_INTEGER,
    }
    expect(roundTrip(data)).toEqual(data)
  })

  it('round-trips a category without account and a transaction without category', () => {
    const data = fixtureDocument()
    const rebuilt = roundTrip(data)
    expect(rebuilt.budgetMonths[0].expenseCategories[1].accountId).toBeNull()
    expect(rebuilt.importedTransactions[1].categoryId).toBeNull()
    expect(rebuilt).toEqual(data)
  })

  it('round-trips a document whose arrays are deliberately shuffled', () => {
    const data = fixtureDocument()
    const shuffled = clone(data)
    shuffled.budgetMonths.reverse()
    for (const month of shuffled.budgetMonths) {
      month.incomes.reverse()
      month.accounts.reverse()
      month.expenseCategories.reverse()
      for (const category of month.expenseCategories) category.items.reverse()
    }
    shuffled.importedTransactions.reverse()
    expect(roundTrip(shuffled)).toEqual(data)
  })

  it('keeps transactions booked in months without a budget', () => {
    const data = fixtureDocument()
    data.importedTransactions.push(transaction(4, '2024-12-31', null))
    expect(roundTrip(data)).toEqual(canonicalizeAppData(data))
  })

  it('is the identity for snapshots made by documentToEntities', () => {
    for (const seed of SEEDS) {
      const snapshot = documentToEntities(createSyntheticAppData(seed))
      expect(documentToEntities(entitiesToDocument(snapshot))).toEqual(snapshot)
    }
    const snapshot = fixtureSnapshot()
    expect(documentToEntities(entitiesToDocument(snapshot))).toEqual(snapshot)
  })
})

describe('documentToEntities', () => {
  it('is deterministic and independent of the input order', () => {
    const data = createSyntheticAppData(11, { shuffle: true })
    expect(documentToEntities(data)).toEqual(documentToEntities(data))
    expect(JSON.stringify(documentToEntities(data))).toBe(
      JSON.stringify(documentToEntities(clone(data))),
    )
  })

  it('sets timestamps from the document and deletes nothing', () => {
    const snapshot = fixtureSnapshot()
    const [january, february] = snapshot.months
    expect(january).toMatchObject({
      id: id(1),
      createdAt: '2025-01-01T09:00:00.000Z',
      editedAt: '2025-01-20T10:30:00.123Z',
      updatedAt: '2025-01-20T10:30:00.123Z',
      deletedAt: null,
    })
    expect(february.updatedAt).toBe('2025-02-03T11:00:00.000Z')
    expect(snapshot.incomes[0].updatedAt).toBe(january.updatedAt)
    expect(snapshot.accounts[2].updatedAt).toBe(february.updatedAt)
    expect(snapshot.expenseCategories[0].updatedAt).toBe(january.updatedAt)
    expect(snapshot.expenseItems[3].updatedAt).toBe(february.updatedAt)
    expect(snapshot.importedTransactions.map((row) => row.updatedAt)).toEqual(
      snapshot.importedTransactions.map((row) => row.importedAt),
    )
    expect(snapshot.settings).toEqual({
      activeBudgetMonthId: id(2),
      updatedAt: '2025-02-03T11:00:00.000Z',
    })
    const rows = [
      ...snapshot.months,
      ...snapshot.incomes,
      ...snapshot.accounts,
      ...snapshot.expenseCategories,
      ...snapshot.expenseItems,
      ...snapshot.importedTransactions,
    ]
    expect(rows.every((row) => row.deletedAt === null)).toBe(true)
  })

  it('uses the latest month updatedAt for the settings, whatever the month order', () => {
    const data = fixtureDocument()
    data.budgetMonths[0].updatedAt = '2025-09-01T00:00:00.000Z'
    expect(documentToEntities(data).settings.updatedAt).toBe(
      '2025-09-01T00:00:00.000Z',
    )
  })

  it.each(SEEDS.slice(0, 30))(
    'produces valid, consistent rows for seed %i',
    (seed) => {
      const data = createSyntheticAppData(seed)
      const snapshot = documentToEntities(data)
      expect(entitySnapshotSchema.safeParse(snapshot).success).toBe(true)

      const categories = data.budgetMonths.flatMap(
        (month) => month.expenseCategories,
      )
      expect(snapshot.months).toHaveLength(data.budgetMonths.length)
      expect(snapshot.incomes).toHaveLength(
        data.budgetMonths.reduce((sum, month) => sum + month.incomes.length, 0),
      )
      expect(snapshot.accounts).toHaveLength(
        data.budgetMonths.reduce((sum, month) => sum + month.accounts.length, 0),
      )
      expect(snapshot.expenseCategories).toHaveLength(categories.length)
      expect(snapshot.expenseItems).toHaveLength(
        categories.reduce((sum, category) => sum + category.items.length, 0),
      )
      expect(snapshot.importedTransactions).toHaveLength(
        data.importedTransactions.length,
      )

      const monthIds = new Set(snapshot.months.map((row) => row.id))
      const accountIds = new Map(
        snapshot.accounts.map((row) => [row.id, row.monthId]),
      )
      const categoryIds = new Set(snapshot.expenseCategories.map((row) => row.id))
      expect(snapshot.incomes.every((row) => monthIds.has(row.monthId))).toBe(true)
      expect(snapshot.accounts.every((row) => monthIds.has(row.monthId))).toBe(true)
      expect(
        snapshot.expenseCategories.every(
          (row) =>
            monthIds.has(row.monthId) &&
            (row.accountId === null ||
              accountIds.get(row.accountId) === row.monthId),
        ),
      ).toBe(true)
      expect(
        snapshot.expenseItems.every((row) => categoryIds.has(row.categoryId)),
      ).toBe(true)
      expect(
        snapshot.importedTransactions.every(
          (row) => row.categoryId === null || categoryIds.has(row.categoryId),
        ),
      ).toBe(true)
      expect(monthIds.has(snapshot.settings.activeBudgetMonthId ?? '')).toBe(true)

      const allIds = [
        ...snapshot.months,
        ...snapshot.incomes,
        ...snapshot.accounts,
        ...snapshot.expenseCategories,
        ...snapshot.expenseItems,
        ...snapshot.importedTransactions,
      ].map((row) => row.id)
      expect(new Set(allIds).size).toBe(allIds.length)

      const documentIds = [
        ...data.budgetMonths.flatMap((month) => [
          month.id,
          ...month.incomes.map((row) => row.id),
          ...month.accounts.map((row) => row.id),
          ...month.expenseCategories.flatMap((category) => [
            category.id,
            ...category.items.map((row) => row.id),
          ]),
        ]),
        ...data.importedTransactions.map((row) => row.id),
      ]
      expect([...allIds].sort()).toEqual([...documentIds].sort())
    },
  )

  it('emits rows in canonical order', () => {
    const snapshot = documentToEntities(
      createSyntheticAppData(5, { shuffle: true }),
    )
    const monthKeys = snapshot.months.map((row) => row.year * 12 + row.month)
    expect(monthKeys).toEqual([...monthKeys].sort((a, b) => a - b))
    const dates = snapshot.importedTransactions.map((row) => row.bookingDate)
    expect(dates).toEqual([...dates].sort())
  })

  it('fails the snapshot schema for a bad id or a bad timestamp', () => {
    const badId = fixtureSnapshot()
    badId.incomes[0].id = 'not-a-uuid'
    expect(entitySnapshotSchema.safeParse(badId).success).toBe(false)

    const badDate = fixtureSnapshot()
    badDate.months[0].editedAt = 'yesterday'
    expect(entitySnapshotSchema.safeParse(badDate).success).toBe(false)

    const tooBig = fixtureSnapshot()
    tooBig.accounts[0].plannedTransferCents = MAX_AMOUNT_CENTS + 1
    expect(entitySnapshotSchema.safeParse(tooBig).success).toBe(false)

    const badVersion = { ...fixtureSnapshot(), schemaVersion: 2 }
    expect(entitySnapshotSchema.safeParse(badVersion).success).toBe(false)
  })
})

describe('entitiesToDocument', () => {
  it('drops a deleted month with its children', () => {
    const snapshot = fixtureSnapshot()
    markDeleted(snapshot.months, id(1))
    const document = entitiesToDocument(snapshot)
    expect(document.budgetMonths.map((month) => month.id)).toEqual([id(2)])
    // The transactions stay, but lose their category when it vanished with the month.
    expect(document.importedTransactions.map((row) => row.id)).toEqual([
      id(901),
      id(902),
      id(903),
    ])
    expect(document.importedTransactions[0].categoryId).toBeNull()
    expect(document.importedTransactions[2].categoryId).toBe(id(33))
  })

  it('ignores child rows of a missing month or category', () => {
    const snapshot = fixtureSnapshot()
    snapshot.months = snapshot.months.filter((row) => row.id !== id(2))
    const document = entitiesToDocument(snapshot)
    expect(document.budgetMonths).toHaveLength(1)
    expect(document.importedTransactions[2].categoryId).toBeNull()

    const orphan = fixtureSnapshot()
    orphan.expenseCategories = orphan.expenseCategories.filter(
      (row) => row.id !== id(31),
    )
    const rebuilt = entitiesToDocument(orphan)
    expect(rebuilt.budgetMonths[0].expenseCategories.map((row) => row.id)).toEqual([
      id(32),
    ])
    expect(rebuilt.importedTransactions[0].categoryId).toBeNull()
  })

  it('sets accountId to null when the account is deleted, missing or in another month', () => {
    const deleted = fixtureSnapshot()
    markDeleted(deleted.accounts, id(21))
    const afterDelete = entitiesToDocument(deleted)
    expect(afterDelete.budgetMonths[0].expenseCategories[0].accountId).toBeNull()
    expect(afterDelete.budgetMonths[0].accounts.map((row) => row.id)).toEqual([id(22)])
    expect(afterDelete.budgetMonths[0].accounts[0].sortOrder).toBe(0)

    const missing = fixtureSnapshot()
    missing.accounts = missing.accounts.filter((row) => row.id !== id(21))
    expect(
      entitiesToDocument(missing).budgetMonths[0].expenseCategories[0].accountId,
    ).toBeNull()

    const elsewhere = fixtureSnapshot()
    const category = elsewhere.expenseCategories.find((row) => row.id === id(33))!
    category.accountId = id(21)
    expect(
      entitiesToDocument(elsewhere).budgetMonths[1].expenseCategories[0].accountId,
    ).toBeNull()
  })

  it('nulls a transaction category that is deleted and drops its items', () => {
    const snapshot = fixtureSnapshot()
    markDeleted(snapshot.expenseCategories, id(31))
    const document = entitiesToDocument(snapshot)
    const january = document.budgetMonths[0]
    expect(january.expenseCategories.map((row) => row.id)).toEqual([id(32)])
    expect(january.expenseCategories[0].sortOrder).toBe(0)
    const itemIds = document.budgetMonths.flatMap((month) =>
      month.expenseCategories.flatMap((category) =>
        category.items.map((item) => item.id),
      ),
    )
    expect(itemIds).toEqual([id(43), id(44)])
    expect(document.importedTransactions[0].categoryId).toBeNull()
    expect(document.importedTransactions[2].categoryId).toBe(id(33))
  })

  it('nulls a transaction category that belongs to another month than the booking date', () => {
    const snapshot = fixtureSnapshot()
    snapshot.importedTransactions[2].categoryId = id(31)
    const document = entitiesToDocument(snapshot)
    expect(document.importedTransactions[2].categoryId).toBeNull()
    expect(document.importedTransactions[0].categoryId).toBe(id(31))
  })

  it('removes a deleted transaction and soft-deleted children', () => {
    const snapshot = fixtureSnapshot()
    markDeleted(snapshot.importedTransactions, id(902))
    markDeleted(snapshot.incomes, id(11))
    markDeleted(snapshot.expenseItems, id(41))
    const document = entitiesToDocument(snapshot)
    expect(document.importedTransactions.map((row) => row.id)).toEqual([
      id(901),
      id(903),
    ])
    expect(document.budgetMonths[0].incomes.map((row) => row.id)).toEqual([id(12)])
    expect(document.budgetMonths[0].incomes[0].sortOrder).toBe(0)
    expect(
      document.budgetMonths[0].expenseCategories[0].items.map((row) => row.id),
    ).toEqual([id(42)])
  })

  it('sorts by (sortOrder, id) and rewrites sortOrder deterministically', () => {
    const snapshot = fixtureSnapshot()
    snapshot.incomes.push({
      ...snapshot.incomes[0],
      id: id(14),
      monthId: id(1),
      sortOrder: 40,
    })
    snapshot.incomes[0].sortOrder = 7 // id 11
    snapshot.incomes[1].sortOrder = 7 // id 12, same order: id breaks the tie
    const forward = entitiesToDocument(snapshot)
    const incomes = forward.budgetMonths[0].incomes
    expect(incomes.map((row) => row.id)).toEqual([id(11), id(12), id(14)])
    expect(incomes.map((row) => row.sortOrder)).toEqual([0, 1, 2])

    const reversed = clone(snapshot)
    reversed.incomes.reverse()
    reversed.months.reverse()
    reversed.importedTransactions.reverse()
    expect(entitiesToDocument(reversed)).toEqual(forward)
  })

  it('falls back to the latest live month when the active month is not live', () => {
    const deleted = fixtureSnapshot()
    markDeleted(deleted.months, id(2))
    expect(entitiesToDocument(deleted).settings.activeBudgetMonthId).toBe(id(1))

    const unknown = fixtureSnapshot()
    unknown.settings.activeBudgetMonthId = id(777)
    expect(entitiesToDocument(unknown).settings.activeBudgetMonthId).toBe(id(2))

    const none = fixtureSnapshot()
    none.settings.activeBudgetMonthId = null
    expect(entitiesToDocument(none).settings.activeBudgetMonthId).toBe(id(2))

    const kept = fixtureSnapshot()
    kept.settings.activeBudgetMonthId = id(1)
    expect(entitiesToDocument(kept).settings.activeBudgetMonthId).toBe(id(1))
  })

  it('uses the latest month by year and month, not by row order', () => {
    const snapshot = fixtureSnapshot()
    snapshot.months.reverse()
    snapshot.settings.activeBudgetMonthId = null
    expect(entitiesToDocument(snapshot).settings.activeBudgetMonthId).toBe(id(2))
  })

  it('takes the month updatedAt from editedAt', () => {
    const snapshot = fixtureSnapshot()
    snapshot.months[0].editedAt = '2025-05-05T05:05:05.005Z'
    snapshot.months[0].updatedAt = '2030-01-01T00:00:00.000Z'
    expect(entitiesToDocument(snapshot).budgetMonths[0].updatedAt).toBe(
      '2025-05-05T05:05:05.005Z',
    )
  })

  it('throws no-live-month when no month is live', () => {
    const empty = fixtureSnapshot()
    empty.months = []
    expect(thrownCode(() => entitiesToDocument(empty))).toBe('no-live-month')

    const deleted = fixtureSnapshot()
    deleted.months.forEach((row) => {
      row.deletedAt = '2025-03-01T00:00:00.000Z'
    })
    expect(thrownCode(() => entitiesToDocument(deleted))).toBe('no-live-month')
    expect(() => entitiesToDocument(deleted)).toThrow(EntityConversionError)
  })

  it('throws duplicate-month when two live months share a year and month', () => {
    const snapshot = fixtureSnapshot()
    snapshot.months[1].year = snapshot.months[0].year
    snapshot.months[1].month = snapshot.months[0].month
    expect(thrownCode(() => entitiesToDocument(snapshot))).toBe('duplicate-month')

    // A deleted month may share the slot of a live one.
    const allowed = fixtureSnapshot()
    allowed.months[1].year = allowed.months[0].year
    allowed.months[1].month = allowed.months[0].month
    allowed.months[1].deletedAt = '2025-03-01T00:00:00.000Z'
    expect(() => entitiesToDocument(allowed)).not.toThrow()
  })

  it('throws invalid-result when the rebuilt document breaks the schema', () => {
    const snapshot = fixtureSnapshot()
    snapshot.importedTransactions[1].sourceKey =
      snapshot.importedTransactions[0].sourceKey
    expect(thrownCode(() => entitiesToDocument(snapshot))).toBe('invalid-result')

    const duplicateId = fixtureSnapshot()
    duplicateId.incomes[1].id = duplicateId.incomes[0].id
    expect(thrownCode(() => entitiesToDocument(duplicateId))).toBe('invalid-result')
  })

  it('always returns a document that passes parseAppData', () => {
    for (const seed of SEEDS) {
      const snapshot = documentToEntities(createSyntheticAppData(seed))
      expect(() => parseAppData(entitiesToDocument(snapshot))).not.toThrow()
    }
  })

  it('keeps live rows when random rows are soft-deleted', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const snapshot = documentToEntities(createSyntheticAppData(seed))
      snapshot.accounts.forEach((row, index) => {
        if (index % 2 === 0) row.deletedAt = '2025-03-01T00:00:00.000Z'
      })
      snapshot.expenseCategories.forEach((row, index) => {
        if (index % 3 === 0) row.deletedAt = '2025-03-01T00:00:00.000Z'
      })
      snapshot.importedTransactions.forEach((row, index) => {
        if (index % 4 === 0) row.deletedAt = '2025-03-01T00:00:00.000Z'
      })
      expect(() => parseAppData(entitiesToDocument(snapshot))).not.toThrow()
    }
  })
})

describe('purity', () => {
  it('never mutates frozen inputs', () => {
    for (const seed of [1, 2, 3]) {
      const data = deepFreeze(createSyntheticAppData(seed, { shuffle: true }))
      const snapshot = deepFreeze(documentToEntities(data))
      expect(() => canonicalizeAppData(data)).not.toThrow()
      expect(() => documentToEntities(data)).not.toThrow()
      expect(() => entitiesToDocument(snapshot)).not.toThrow()
    }
  })

  it('returns rows that do not share objects with the input document', () => {
    const data = fixtureDocument()
    const before = JSON.stringify(data)
    const snapshot = documentToEntities(data)
    snapshot.incomes[0].name = 'Changed'
    const rebuilt = entitiesToDocument(snapshot)
    rebuilt.budgetMonths[0].name = 'Changed too'
    expect(JSON.stringify(data)).toBe(before)
  })
})
