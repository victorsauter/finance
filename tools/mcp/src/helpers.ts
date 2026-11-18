import type { AppData, BudgetMonth, ImportedTransaction } from '../../../src/domain/budget/models.ts'
import { findBudget, monthKey } from '../../../src/domain/budget/factory.ts'
import { formatMoney } from '../../../src/domain/budget/money.ts'
import { formatTransactionAmount } from '../../../src/domain/transactions/format.ts'
import { normalizeText } from '../../../src/domain/transactions/revolut-csv.ts'

/** An error whose message is meant for the assistant and the owner. */
export class ToolError extends Error {}

export const UNCATEGORISED = '(uncategorised)'

export function money(cents: number) {
  return { cents, formatted: formatMoney(cents) }
}

export function transactionMoney(cents: number, currency: string) {
  return { cents, formatted: formatTransactionAmount(cents, currency) }
}

export function parseMonth(value: string): { year: number; month: number; key: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim())
  const year = Number(match?.[1])
  const month = Number(match?.[2])
  if (!match || month < 1 || month > 12) throw new ToolError(`"${value}" is not a month: use YYYY-MM.`)
  return { year, month, key: monthKey(year, month) }
}

/** Inclusive date bound: `YYYY-MM-DD`, or `YYYY-MM` for the whole month. */
export function dateBound(value: string | undefined, side: 'from' | 'to'): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    parseMonth(trimmed)
    return side === 'from' ? `${trimmed}-01` : `${trimmed}-31`
  }
  throw new ToolError(`"${value}" is not a date: use YYYY-MM-DD or YYYY-MM.`)
}

export function inDateRange(date: string, from?: string, to?: string) {
  return (from === undefined || date >= from) && (to === undefined || date <= to)
}

export function budgetKey(budget: BudgetMonth) {
  return monthKey(budget.year, budget.month)
}

export function transactionMonth(transaction: ImportedTransaction) {
  return transaction.bookingDate.slice(0, 7)
}

export function requireBudget(data: AppData, month: string): BudgetMonth {
  const { year, month: monthNumber } = parseMonth(month)
  const budget = findBudget(data, year, monthNumber)
  if (!budget) {
    const months = data.budgetMonths.map(budgetKey).sort().join(', ')
    throw new ToolError(`There is no budget for ${month}. Budget months: ${months}.`)
  }
  return budget
}

/** Category id → name and month, across every budget month. */
export function categoryIndex(data: AppData) {
  const index = new Map<string, { name: string; month: string }>()
  for (const budget of data.budgetMonths) {
    for (const category of budget.expenseCategories) {
      index.set(category.id, { name: category.name, month: budgetKey(budget) })
    }
  }
  return index
}

export function categoryLabel(index: ReturnType<typeof categoryIndex>, id: string | null) {
  if (id === null) return UNCATEGORISED
  return index.get(id)?.name ?? `(unknown category ${id})`
}

/** The merchant key: the description compared like the CSV importer does. */
export function merchantKey(description: string) {
  return normalizeText(description)
}

export function sameName(a: string, b: string) {
  return normalizeText(a) === normalizeText(b)
}

export interface Page<T> {
  total: number
  offset: number
  limit: number
  nextOffset: number | null
  items: T[]
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export function paginate<T>(items: T[], limit = DEFAULT_LIMIT, offset = 0): Page<T> {
  const size = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
  const start = Math.max(Math.trunc(offset), 0)
  const page = items.slice(start, start + size)
  return {
    total: items.length,
    offset: start,
    limit: size,
    nextOffset: start + page.length < items.length ? start + page.length : null,
    items: page,
  }
}
