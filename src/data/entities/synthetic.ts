import type {
  Account,
  AppData,
  BudgetMonth,
  ExpenseCategory,
  ExpenseItem,
  ImportedTransaction,
  ImportedTransactionKind,
  Income,
} from '@/domain/budget/models'
import { CURRENT_SCHEMA_VERSION } from '@/domain/budget/models'
import { MAX_AMOUNT_CENTS } from '@/domain/budget/money'
import { canonicalizeAppData } from './convert'

export interface SyntheticOptions {
  /** Number of consecutive budget months. Default: 3 to 6, from the seed. */
  monthCount?: number
  /** Imported transactions booked in each budget month. Default: 0 to 8. */
  transactionsPerMonth?: number
  /**
   * When true, every array comes out in a random order instead of the
   * canonical one (`sortOrder` keeps its value), to exercise canonicalization.
   */
  shuffle?: boolean
}

/** Small seeded generator (mulberry32): same seed, same sequence. */
function createRandom(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1))
  const chance = (probability: number) => next() < probability
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]
  const hex = (digits: number) =>
    Array.from({ length: digits }, () => int(0, 15).toString(16)).join('')
  /** A v4-shaped UUID built from the generator. */
  const uuid = () =>
    `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`
  const shuffle = <T>(items: T[]): T[] => {
    const copy = [...items]
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = int(0, index)
      const held = copy[index]
      copy[index] = copy[other]
      copy[other] = held
    }
    return copy
  }
  return { next, int, chance, pick, uuid, shuffle }
}

const MAX_TIME = Date.UTC(2200, 0, 1)

function isoAt(time: number): string {
  return new Date(Math.min(time, MAX_TIME)).toISOString()
}

function padded(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Builds a valid, fully fake document from a seed. Deterministic: no clock and
 * no `Math.random`. It covers several months, incomes, accounts, categories
 * with and without an account, items, and transactions with and without a
 * category (including some booked in months that have no budget).
 */
export function createSyntheticAppData(
  seed: number,
  options: SyntheticOptions = {},
): AppData {
  const random = createRandom(seed)
  const { int, chance, pick, uuid } = random
  const amount = () =>
    chance(0.03) ? MAX_AMOUNT_CENTS : chance(0.1) ? 0 : int(1, 900_000)

  const monthCount = options.monthCount ?? int(3, 6)
  const startYear = int(2020, 2030)
  const startMonthIndex = int(0, 11)

  const budgetMonths: BudgetMonth[] = []
  const importedTransactions: ImportedTransaction[] = []
  let transactionCounter = 0

  for (let offset = 0; offset < monthCount; offset += 1) {
    const total = startMonthIndex + offset
    const year = startYear + Math.floor(total / 12)
    const month = (total % 12) + 1
    const createdAt = isoAt(
      Date.UTC(year, month - 1, int(1, 28), int(0, 23), int(0, 59), int(0, 59), int(0, 999)),
    )
    const updatedAt = isoAt(Date.parse(createdAt) + int(0, 40 * 86_400_000))

    const incomes: Income[] = Array.from({ length: int(1, 4) }, (_, index) => ({
      id: uuid(),
      name: `Synthetic income ${index + 1}`,
      amountCents: amount(),
      sortOrder: index,
    }))
    const accounts: Account[] = Array.from({ length: int(0, 3) }, (_, index) => ({
      id: uuid(),
      name: `Synthetic account ${index + 1}`,
      plannedTransferCents: amount(),
      sortOrder: index,
    }))
    const expenseCategories: ExpenseCategory[] = Array.from(
      { length: int(0, 5) },
      (_, index) => ({
        id: uuid(),
        name: `Synthetic category ${index + 1}`,
        accountId:
          accounts.length > 0 && chance(0.7) ? pick(accounts).id : null,
        items: Array.from(
          { length: int(0, 4) },
          (_item, itemIndex): ExpenseItem => ({
            id: uuid(),
            name: `Synthetic item ${index + 1}.${itemIndex + 1}`,
            amountCents: amount(),
            sortOrder: itemIndex,
          }),
        ),
        sortOrder: index,
      }),
    )

    budgetMonths.push({
      id: uuid(),
      year,
      month,
      name: `Synthetic month ${year}-${padded(month)}`,
      incomes,
      accounts,
      expenseCategories,
      createdAt,
      updatedAt,
    })

    const count = options.transactionsPerMonth ?? int(0, 8)
    for (let index = 0; index < count; index += 1) {
      importedTransactions.push(
        createTransaction(
          year,
          month,
          expenseCategories.length > 0 && chance(0.6)
            ? pick(expenseCategories).id
            : null,
        ),
      )
    }
  }

  // Some transactions fall in a month that has no budget: they have no category.
  const orphanCount = int(0, 3)
  for (let index = 0; index < orphanCount; index += 1) {
    importedTransactions.push(createTransaction(startYear - 1, 12, null))
  }

  function createTransaction(
    year: number,
    month: number,
    categoryId: string | null,
  ): ImportedTransaction {
    transactionCounter += 1
    const kind: ImportedTransactionKind = pick(['expense', 'income', 'transfer'])
    const cents = int(1, 400_000)
    const day = int(1, 28)
    const importedAt = isoAt(
      Date.UTC(year, month - 1, day, int(0, 23), int(0, 59), int(0, 59), int(0, 999)) +
        int(0, 3 * 86_400_000),
    )
    return {
      id: uuid(),
      provider: 'revolut-csv',
      sourceKey: `synthetic-key-${seed}-${transactionCounter}`,
      sourceReference: chance(0.5)
        ? `Synthetic reference ${transactionCounter}`
        : null,
      importBatchId: uuid(),
      sourceFileName: `synthetic-export-${int(1, 3)}.csv`,
      bookingDate: `${year}-${padded(month)}-${padded(day)}`,
      startedAt: chance(0.7)
        ? `${year}-${padded(month)}-${padded(day)} 10:${padded(int(0, 59))}:00`
        : null,
      completedAt: chance(0.7)
        ? `${year}-${padded(month)}-${padded(day)} 11:${padded(int(0, 59))}:00`
        : null,
      description: `Synthetic transaction ${transactionCounter}`,
      amountCents: kind === 'income' ? cents : -cents,
      feeCents: chance(0.2) ? int(1, 500) : 0,
      balanceCents: chance(0.6) ? int(-100_000, 5_000_000) : null,
      currency: 'EUR',
      transactionType: chance(0.5) ? 'CARD_PAYMENT' : null,
      product: chance(0.5) ? 'Current' : null,
      kind,
      categoryId,
      importedAt,
    }
  }

  const document: AppData = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { activeBudgetMonthId: pick(budgetMonths).id },
    budgetMonths,
    importedTransactions,
  }

  if (!options.shuffle) return canonicalizeAppData(document)

  return {
    ...document,
    budgetMonths: random.shuffle(
      document.budgetMonths.map((month) => ({
        ...month,
        incomes: random.shuffle(month.incomes),
        accounts: random.shuffle(month.accounts),
        expenseCategories: random.shuffle(
          month.expenseCategories.map((category) => ({
            ...category,
            items: random.shuffle(category.items),
          })),
        ),
      })),
    ),
    importedTransactions: random.shuffle(document.importedTransactions),
  }
}
