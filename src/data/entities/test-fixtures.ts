import type {
  AppData,
  ImportedTransaction,
} from '@/domain/budget/models'
import { MAX_AMOUNT_CENTS } from '@/domain/budget/money'

/** A valid UUID built from a small number, so tests can name their rows. */
export function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** Freezes a value and everything reachable from it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

export function transaction(
  n: number,
  bookingDate: string,
  categoryId: string | null,
  overrides: Partial<ImportedTransaction> = {},
): ImportedTransaction {
  return {
    id: id(900 + n),
    provider: 'revolut-csv',
    sourceKey: `synthetic-key-${n}`,
    sourceReference: null,
    importBatchId: id(990),
    sourceFileName: 'synthetic-export.csv',
    bookingDate,
    startedAt: null,
    completedAt: null,
    description: `Synthetic transaction ${n}`,
    amountCents: -1_250 * n,
    feeCents: 0,
    balanceCents: null,
    currency: 'EUR',
    transactionType: null,
    product: null,
    kind: 'expense',
    categoryId,
    importedAt: `2025-02-0${n}T08:00:00.000Z`,
    ...overrides,
  }
}

/**
 * A small hand-written canonical document: two months (January listed first),
 * links between accounts, categories, items and transactions.
 *
 * Ids: months 1-2, incomes 11-13, accounts 21-23, categories 31-33,
 * items 41-44, transactions 901-903.
 */
export function fixtureDocument(): AppData {
  return {
    schemaVersion: 2,
    settings: { activeBudgetMonthId: id(2) },
    budgetMonths: [
      {
        id: id(1),
        year: 2025,
        month: 1,
        name: 'Synthetic January',
        incomes: [
          { id: id(11), name: 'Synthetic income 1', amountCents: 300_000, sortOrder: 0 },
          { id: id(12), name: 'Synthetic income 2', amountCents: 50_000, sortOrder: 1 },
        ],
        accounts: [
          { id: id(21), name: 'Synthetic account 1', plannedTransferCents: 100_000, sortOrder: 0 },
          { id: id(22), name: 'Synthetic account 2', plannedTransferCents: 0, sortOrder: 1 },
        ],
        expenseCategories: [
          {
            id: id(31),
            name: 'Synthetic category 1',
            accountId: id(21),
            items: [
              { id: id(41), name: 'Synthetic item 1', amountCents: 80_000, sortOrder: 0 },
              { id: id(42), name: 'Synthetic item 2', amountCents: 5_000, sortOrder: 1 },
            ],
            sortOrder: 0,
          },
          {
            id: id(32),
            name: 'Synthetic category 2',
            accountId: null,
            items: [
              { id: id(43), name: 'Synthetic item 3', amountCents: 1_000, sortOrder: 0 },
            ],
            sortOrder: 1,
          },
        ],
        createdAt: '2025-01-01T09:00:00.000Z',
        updatedAt: '2025-01-20T10:30:00.123Z',
      },
      {
        id: id(2),
        year: 2025,
        month: 2,
        name: 'Synthetic February',
        incomes: [
          { id: id(13), name: 'Synthetic income 3', amountCents: MAX_AMOUNT_CENTS, sortOrder: 0 },
        ],
        accounts: [
          { id: id(23), name: 'Synthetic account 3', plannedTransferCents: 20_000, sortOrder: 0 },
        ],
        expenseCategories: [
          {
            id: id(33),
            name: 'Synthetic category 3',
            accountId: id(23),
            items: [
              { id: id(44), name: 'Synthetic item 4', amountCents: 20_000, sortOrder: 0 },
            ],
            sortOrder: 0,
          },
        ],
        createdAt: '2025-02-01T09:00:00.000Z',
        updatedAt: '2025-02-03T11:00:00.000Z',
      },
    ],
    importedTransactions: [
      transaction(1, '2025-01-10', id(31), {
        importedAt: '2025-01-11T08:00:00.000Z',
      }),
      transaction(2, '2025-01-12', null, {
        importedAt: '2025-01-13T08:00:00.000Z',
      }),
      transaction(3, '2025-02-05', id(33), {
        importedAt: '2025-02-06T08:00:00.000Z',
      }),
    ],
  }
}
