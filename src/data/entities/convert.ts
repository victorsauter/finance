import { monthKey } from '@/domain/budget/factory'
import type {
  Account,
  AppData,
  BudgetMonth,
  EntityId,
  ExpenseCategory,
  ExpenseItem,
  ImportedTransaction,
  Income,
} from '@/domain/budget/models'
import { CURRENT_SCHEMA_VERSION } from '@/domain/budget/models'
import { parseAppData } from '@/domain/budget/schema'
import type {
  BudgetAccountRow,
  BudgetExpenseCategoryRow,
  BudgetExpenseItemRow,
  BudgetIncomeRow,
  BudgetMonthRow,
  EntitySnapshot,
  ImportedTransactionRow,
} from './rows'
import { ENTITY_SNAPSHOT_VERSION } from './rows'

export type EntityConversionErrorCode =
  /** The snapshot has no live month, so no valid document can be built. */
  | 'no-live-month'
  /** Two live months share the same year and month. */
  | 'duplicate-month'
  /** The document built from the rows fails the document schema. */
  | 'invalid-result'
  /** The document given to a migration fails the document schema. */
  | 'invalid-document'
  /** The snapshot given to a procedure fails the snapshot schema. */
  | 'invalid-snapshot'
  /** Converting a document to rows and back did not give the same document. */
  | 'round-trip-mismatch'

/** Thrown by the conversions; `code` is stable and meant for programs. */
export class EntityConversionError extends Error {
  readonly code: EntityConversionErrorCode

  constructor(
    code: EntityConversionErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'EntityConversionError'
    this.code = code
  }
}

/** Timestamp used for the settings row of a document without any month. */
const EMPTY_DOCUMENT_TIMESTAMP = '1970-01-01T00:00:00.000Z'

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function byOrderThenId(
  a: { sortOrder: number; id: string },
  b: { sortOrder: number; id: string },
): number {
  return a.sortOrder - b.sortOrder || compareText(a.id, b.id)
}

function byYearMonthThenId(
  a: { year: number; month: number; id: string },
  b: { year: number; month: number; id: string },
): number {
  return a.year - b.year || a.month - b.month || compareText(a.id, b.id)
}

function sortedByOrder<T extends { sortOrder: number; id: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort(byOrderThenId)
}

/**
 * Returns a copy of the document in canonical order: months by (year, month),
 * each list by (sortOrder, id), transactions by (bookingDate, id). Nothing
 * else changes. The input is never modified.
 */
export function canonicalizeAppData(data: AppData): AppData {
  return {
    schemaVersion: data.schemaVersion,
    settings: { ...data.settings },
    budgetMonths: [...data.budgetMonths].sort(byYearMonthThenId).map(
      (month): BudgetMonth => ({
        ...month,
        incomes: sortedByOrder(month.incomes).map((income) => ({ ...income })),
        accounts: sortedByOrder(month.accounts).map((account) => ({
          ...account,
        })),
        expenseCategories: sortedByOrder(month.expenseCategories).map(
          (category): ExpenseCategory => ({
            ...category,
            items: sortedByOrder(category.items).map((item) => ({ ...item })),
          }),
        ),
      }),
    ),
    importedTransactions: [...data.importedTransactions]
      .sort(
        (a, b) =>
          compareText(a.bookingDate, b.bookingDate) || compareText(a.id, b.id),
      )
      .map((transaction) => ({ ...transaction })),
  }
}

function latestTimestamp(timestamps: string[]): string {
  let latest: string | null = null
  for (const timestamp of timestamps) {
    if (latest === null || Date.parse(timestamp) > Date.parse(latest)) {
      latest = timestamp
    }
  }
  return latest ?? EMPTY_DOCUMENT_TIMESTAMP
}

/**
 * Splits a document into per-entity rows. Pure and deterministic: ids are
 * kept, nothing reads the clock, and rows come out in canonical order. Every
 * child row takes its month's `updatedAt`; a transaction takes its
 * `importedAt`; nothing is deleted.
 */
export function documentToEntities(data: AppData): EntitySnapshot {
  const canonical = canonicalizeAppData(data)
  const snapshot: EntitySnapshot = {
    schemaVersion: ENTITY_SNAPSHOT_VERSION,
    months: [],
    incomes: [],
    accounts: [],
    expenseCategories: [],
    expenseItems: [],
    importedTransactions: [],
    settings: {
      activeBudgetMonthId: canonical.settings.activeBudgetMonthId,
      updatedAt: latestTimestamp(
        canonical.budgetMonths.map((month) => month.updatedAt),
      ),
    },
  }

  for (const month of canonical.budgetMonths) {
    const meta = { updatedAt: month.updatedAt, deletedAt: null }
    snapshot.months.push({
      id: month.id,
      year: month.year,
      month: month.month,
      name: month.name,
      createdAt: month.createdAt,
      editedAt: month.updatedAt,
      ...meta,
    })
    for (const income of month.incomes) {
      snapshot.incomes.push({
        id: income.id,
        monthId: month.id,
        name: income.name,
        amountCents: income.amountCents,
        sortOrder: income.sortOrder,
        ...meta,
      })
    }
    for (const account of month.accounts) {
      snapshot.accounts.push({
        id: account.id,
        monthId: month.id,
        name: account.name,
        plannedTransferCents: account.plannedTransferCents,
        sortOrder: account.sortOrder,
        ...meta,
      })
    }
    for (const category of month.expenseCategories) {
      snapshot.expenseCategories.push({
        id: category.id,
        monthId: month.id,
        accountId: category.accountId,
        name: category.name,
        sortOrder: category.sortOrder,
        ...meta,
      })
      for (const item of category.items) {
        snapshot.expenseItems.push({
          id: item.id,
          categoryId: category.id,
          name: item.name,
          amountCents: item.amountCents,
          sortOrder: item.sortOrder,
          ...meta,
        })
      }
    }
  }

  for (const transaction of canonical.importedTransactions) {
    snapshot.importedTransactions.push({
      ...transaction,
      updatedAt: transaction.importedAt,
      deletedAt: null,
    })
  }

  return snapshot
}

function isLive<T extends { deletedAt: string | null }>(row: T): boolean {
  return row.deletedAt === null
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(key(row))
    if (group) group.push(row)
    else groups.set(key(row), [row])
  }
  return groups
}

/** Sorts rows by (sortOrder, id) and rewrites `sortOrder` to the index. */
function toOrderedList<Row extends { sortOrder: number; id: string }, Out>(
  rows: Row[] | undefined,
  build: (row: Row, sortOrder: number) => Out,
): Out[] {
  return sortedByOrder(rows ?? []).map((row, index) => build(row, index))
}

function buildTransaction(row: ImportedTransactionRow): ImportedTransaction {
  return {
    id: row.id,
    provider: row.provider,
    sourceKey: row.sourceKey,
    sourceReference: row.sourceReference,
    importBatchId: row.importBatchId,
    sourceFileName: row.sourceFileName,
    bookingDate: row.bookingDate,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    description: row.description,
    amountCents: row.amountCents,
    feeCents: row.feeCents,
    balanceCents: row.balanceCents,
    currency: row.currency,
    transactionType: row.transactionType,
    product: row.product,
    kind: row.kind,
    categoryId: row.categoryId,
    importedAt: row.importedAt,
  }
}

/**
 * Rebuilds a document from rows. Soft-deleted rows are ignored, and so are
 * rows whose month (or category, for items) is deleted or missing. A link
 * that cannot be kept becomes null: a category whose account is gone or lives
 * in another month, a transaction whose category is gone or belongs to another
 * month than its booking date. Lists are sorted by (sortOrder, id) and
 * `sortOrder` is rewritten to the index.
 *
 * Throws an `EntityConversionError` when there is no live month, when two live
 * months share a year and month, or when the result fails the document schema.
 */
export function entitiesToDocument(snapshot: EntitySnapshot): AppData {
  const months = snapshot.months.filter(isLive).sort(byYearMonthThenId)
  if (months.length === 0) {
    throw new EntityConversionError(
      'no-live-month',
      'The snapshot has no live month.',
    )
  }
  const monthKeys = new Set<string>()
  for (const month of months) {
    const key = monthKey(month.year, month.month)
    if (monthKeys.has(key)) {
      throw new EntityConversionError(
        'duplicate-month',
        `Two live months use ${key}.`,
      )
    }
    monthKeys.add(key)
  }

  const liveMonthIds = new Set(months.map((month) => month.id))
  const monthKeyById = new Map(
    months.map((month) => [month.id, monthKey(month.year, month.month)]),
  )

  const incomes = groupBy(
    snapshot.incomes.filter((row) => isLive(row) && liveMonthIds.has(row.monthId)),
    (row) => row.monthId,
  )
  const accountRows = snapshot.accounts.filter(
    (row) => isLive(row) && liveMonthIds.has(row.monthId),
  )
  const accounts = groupBy(accountRows, (row) => row.monthId)
  const accountMonthById = new Map(accountRows.map((row) => [row.id, row.monthId]))
  const categoryRows = snapshot.expenseCategories.filter(
    (row) => isLive(row) && liveMonthIds.has(row.monthId),
  )
  const categories = groupBy(categoryRows, (row) => row.monthId)
  const categoryMonthById = new Map(
    categoryRows.map((row) => [row.id, row.monthId]),
  )
  const items = groupBy(
    snapshot.expenseItems.filter(
      (row) => isLive(row) && categoryMonthById.has(row.categoryId),
    ),
    (row) => row.categoryId,
  )

  const budgetMonths = months.map(
    (month: BudgetMonthRow): BudgetMonth => ({
      id: month.id,
      year: month.year,
      month: month.month,
      name: month.name,
      incomes: toOrderedList(
        incomes.get(month.id),
        (row: BudgetIncomeRow, sortOrder): Income => ({
          id: row.id,
          name: row.name,
          amountCents: row.amountCents,
          sortOrder,
        }),
      ),
      accounts: toOrderedList(
        accounts.get(month.id),
        (row: BudgetAccountRow, sortOrder): Account => ({
          id: row.id,
          name: row.name,
          plannedTransferCents: row.plannedTransferCents,
          sortOrder,
        }),
      ),
      expenseCategories: toOrderedList(
        categories.get(month.id),
        (row: BudgetExpenseCategoryRow, sortOrder): ExpenseCategory => ({
          id: row.id,
          name: row.name,
          accountId:
            row.accountId !== null &&
            accountMonthById.get(row.accountId) === row.monthId
              ? row.accountId
              : null,
          items: toOrderedList(
            items.get(row.id),
            (item: BudgetExpenseItemRow, itemOrder): ExpenseItem => ({
              id: item.id,
              name: item.name,
              amountCents: item.amountCents,
              sortOrder: itemOrder,
            }),
          ),
          sortOrder,
        }),
      ),
      createdAt: month.createdAt,
      updatedAt: month.editedAt,
    }),
  )

  const importedTransactions = snapshot.importedTransactions
    .filter(isLive)
    .map((row) => {
      const transaction = buildTransaction(row)
      const categoryMonthId =
        transaction.categoryId === null
          ? undefined
          : categoryMonthById.get(transaction.categoryId)
      const keepCategory =
        categoryMonthId !== undefined &&
        monthKeyById.get(categoryMonthId) === transaction.bookingDate.slice(0, 7)
      return keepCategory ? transaction : { ...transaction, categoryId: null }
    })
    .sort(
      (a, b) =>
        compareText(a.bookingDate, b.bookingDate) || compareText(a.id, b.id),
    )

  const requestedActive: EntityId | null = snapshot.settings.activeBudgetMonthId
  const activeBudgetMonthId =
    requestedActive !== null && liveMonthIds.has(requestedActive)
      ? requestedActive
      : months[months.length - 1].id

  const document: AppData = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { activeBudgetMonthId },
    budgetMonths,
    importedTransactions,
  }

  try {
    parseAppData(document)
  } catch (error) {
    throw new EntityConversionError(
      'invalid-result',
      'The document built from the rows is not valid.',
      { cause: error },
    )
  }
  return document
}
