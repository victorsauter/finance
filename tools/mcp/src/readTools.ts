/**
 * Read-only views of the finance document, shaped for an assistant: amounts
 * as integer cents plus a formatted string, long lists paginated.
 *
 * Spending, everywhere below, follows the web app's month summary
 * (src/features/transactions/month-summary.ts):
 * - only EUR transactions count; others are listed as nonEuroCount;
 * - a transaction is dated by its bookingDate;
 * - amountCents is signed as on the bank statement: negative = money out;
 * - spending = -amountCents of `expense` transactions with a negative amount,
 *   plus feeCents of every transaction (fees are always money out);
 * - positive `expense` rows (refunds still marked expense) add nothing;
 *   `income` and `transfer` rows are not spending (except their fees);
 * - an expense without category goes to the "(uncategorised)" bucket.
 */
import type { AppData, ImportedTransaction, ImportedTransactionKind } from '../../../src/domain/budget/models.ts'
import { calculateBudgetSummary } from '../../../src/domain/budget/calculations.ts'
import { formatPercent } from '../../../src/domain/budget/money.ts'
import { listMonthKeys, summarizeMonth } from '../../../src/features/transactions/month-summary.ts'
import {
  UNCATEGORISED,
  ToolError,
  budgetKey,
  categoryIndex,
  categoryLabel,
  dateBound,
  inDateRange,
  merchantKey,
  money,
  paginate,
  parseMonth,
  requireBudget,
  sameName,
  transactionMonth,
  transactionMoney,
} from './helpers.ts'

export const FEES_ON_OTHER_KINDS = '(fees on income and transfers)'

function transactionsOfMonth(data: AppData, key: string) {
  return data.importedTransactions.filter((transaction) => transactionMonth(transaction) === key)
}

function byKey(data: AppData) {
  return new Map(data.budgetMonths.map((budget) => [budgetKey(budget), budget]))
}

export function listMonths(data: AppData) {
  const budgets = byKey(data)
  const activeId = data.settings.activeBudgetMonthId
  return {
    months: listMonthKeys(budgets.keys(), data.importedTransactions).map((key) => {
      const budget = budgets.get(key)
      const transactions = transactionsOfMonth(data, key)
      const summary = summarizeMonth(transactions, budget)
      return {
        month: key,
        hasBudget: Boolean(budget),
        active: budget?.id === activeId || undefined,
        transactions: transactions.length,
        uncategorisedExpenses: summary.unclassifiedCount,
        planned: money(summary.plannedExpenseCents),
        spent: money(summary.actualExpenseCents),
      }
    }),
  }
}

export function getBudget(data: AppData, args: { month: string }) {
  const budget = requireBudget(data, args.month)
  const summary = calculateBudgetSummary(budget)
  const accountNames = new Map(budget.accounts.map((account) => [account.id, account.name]))
  const actual = summarizeMonth(transactionsOfMonth(data, budgetKey(budget)), budget)
  return {
    month: budgetKey(budget),
    id: budget.id,
    name: budget.name,
    updatedAt: budget.updatedAt,
    incomes: budget.incomes.map((income) => ({ id: income.id, name: income.name, amount: money(income.amountCents) })),
    accounts: budget.accounts.map((account) => ({
      id: account.id, name: account.name, plannedTransfer: money(account.plannedTransferCents),
    })),
    categories: budget.expenseCategories.map((category) => ({
      id: category.id,
      name: category.name,
      account: category.accountId ? (accountNames.get(category.accountId) ?? null) : null,
      planned: money(category.items.reduce((total, item) => total + item.amountCents, 0)),
      items: category.items.map((item) => ({ id: item.id, name: item.name, amount: money(item.amountCents) })),
    })),
    summary: {
      income: money(summary.incomeCents),
      plannedExpenses: money(summary.expenseCents),
      remaining: money(summary.remainingCents),
      plannedTransfers: money(summary.transferCents),
      unallocatedIncome: money(summary.unallocatedIncomeCents),
      savingsRate: formatPercent(summary.savingsRate),
      unassignedExpenses: money(summary.unassignedExpenseCents),
      accountAllocations: summary.accountAllocations.map((allocation) => ({
        account: allocation.accountName,
        transfer: money(allocation.transferCents),
        usage: money(allocation.usageCents),
        balance: money(allocation.balanceCents),
      })),
    },
    actual: {
      spent: money(actual.actualExpenseCents),
      received: money(actual.actualIncomeCents),
      uncategorisedExpenses: actual.unclassifiedCount,
      nonEuroCount: actual.nonEuroCount,
    },
  }
}

export function listCategories(data: AppData, args: { month?: string }) {
  const budgets = args.month ? [requireBudget(data, args.month)] : data.budgetMonths
  return {
    categories: budgets
      .toSorted((a, b) => budgetKey(a).localeCompare(budgetKey(b)))
      .flatMap((budget) => {
        const accountNames = new Map(budget.accounts.map((account) => [account.id, account.name]))
        return budget.expenseCategories.map((category) => ({
          id: category.id,
          name: category.name,
          month: budgetKey(budget),
          account: category.accountId ? (accountNames.get(category.accountId) ?? null) : null,
          planned: money(category.items.reduce((total, item) => total + item.amountCents, 0)),
        }))
      }),
  }
}

function describe(transaction: ImportedTransaction, index: ReturnType<typeof categoryIndex>) {
  return {
    id: transaction.id,
    date: transaction.bookingDate,
    description: transaction.description,
    amount: transactionMoney(transaction.amountCents, transaction.currency),
    ...(transaction.feeCents ? { fee: transactionMoney(transaction.feeCents, transaction.currency) } : {}),
    kind: transaction.kind,
    categoryId: transaction.categoryId,
    category: transaction.categoryId ? categoryLabel(index, transaction.categoryId) : null,
    ...(transaction.transactionType ? { type: transaction.transactionType } : {}),
  }
}

export interface TransactionFilter {
  month?: string
  from?: string
  to?: string
  /** Category id, category name, or "none" for uncategorised. */
  category?: string
  text?: string
  kind?: ImportedTransactionKind
  limit?: number
  offset?: number
}

function filterTransactions(data: AppData, filter: TransactionFilter) {
  const month = filter.month ? parseMonth(filter.month).key : undefined
  const from = dateBound(filter.from, 'from')
  const to = dateBound(filter.to, 'to')
  const index = categoryIndex(data)
  const text = filter.text ? merchantKey(filter.text) : undefined
  const category = filter.category?.trim()
  return data.importedTransactions
    .filter((transaction) => {
      if (month && transactionMonth(transaction) !== month) return false
      if (!inDateRange(transaction.bookingDate, from, to)) return false
      if (filter.kind && transaction.kind !== filter.kind) return false
      if (text && !merchantKey(transaction.description).includes(text)) return false
      if (category) {
        if (category === 'none') return transaction.categoryId === null
        if (transaction.categoryId === null) return false
        if (transaction.categoryId !== category &&
          !sameName(categoryLabel(index, transaction.categoryId), category)) return false
      }
      return true
    })
    .toSorted((a, b) => b.bookingDate.localeCompare(a.bookingDate) || a.id.localeCompare(b.id))
}

export function listTransactions(data: AppData, filter: TransactionFilter) {
  const index = categoryIndex(data)
  const page = paginate(filterTransactions(data, filter), filter.limit, filter.offset)
  return { ...page, items: page.items.map((transaction) => describe(transaction, index)) }
}

/** Expenses without a category (what the web app counts as "unclassified"). */
export function listUncategorized(data: AppData, args: { month?: string; limit?: number; offset?: number }) {
  return listTransactions(data, { ...args, kind: 'expense', category: 'none' })
}

function spendingOf(transaction: ImportedTransaction) {
  const amount = transaction.kind === 'expense' && transaction.amountCents < 0 ? -transaction.amountCents : 0
  return { amount, fee: transaction.feeCents }
}

export function spendingByCategory(data: AppData, args: { from: string; to: string }) {
  const from = dateBound(args.from, 'from')!
  const to = dateBound(args.to, 'to')!
  const index = categoryIndex(data)
  const buckets = new Map<string, { spentCents: number; count: number; months: Set<string> }>()
  let nonEuroCount = 0
  let totalCents = 0
  const add = (name: string, cents: number, month: string) => {
    const bucket = buckets.get(name) ?? { spentCents: 0, count: 0, months: new Set<string>() }
    bucket.spentCents += cents
    bucket.count += 1
    bucket.months.add(month)
    buckets.set(name, bucket)
    totalCents += cents
  }
  for (const transaction of data.importedTransactions) {
    if (!inDateRange(transaction.bookingDate, from, to)) continue
    if (transaction.currency !== 'EUR') {
      nonEuroCount += 1
      continue
    }
    const { amount, fee } = spendingOf(transaction)
    const month = transactionMonth(transaction)
    if (transaction.kind === 'expense') {
      if (amount + fee > 0) add(categoryLabel(index, transaction.categoryId), amount + fee, month)
    } else if (fee > 0) {
      add(FEES_ON_OTHER_KINDS, fee, month)
    }
  }

  // Planned amounts of the budget months inside the range, by category name.
  const planned = new Map<string, number>()
  for (const budget of data.budgetMonths) {
    const key = budgetKey(budget)
    if (key < from.slice(0, 7) || key > to.slice(0, 7)) continue
    for (const category of budget.expenseCategories) {
      const name = [...planned.keys()].find((existing) => sameName(existing, category.name)) ?? category.name
      planned.set(name, (planned.get(name) ?? 0) + category.items.reduce((total, item) => total + item.amountCents, 0))
    }
  }

  const names = new Set([...buckets.keys(), ...planned.keys()])
  const categories = [...names].map((name) => {
    const bucket = buckets.get(name)
    const plannedCents = planned.get(name)
    return {
      category: name,
      spent: money(bucket?.spentCents ?? 0),
      transactions: bucket?.count ?? 0,
      ...(plannedCents === undefined ? {} : { planned: money(plannedCents) }),
    }
  }).toSorted((a, b) => b.spent.cents - a.spent.cents || a.category.localeCompare(b.category))

  return {
    from,
    to,
    total: money(totalCents),
    nonEuroCount,
    categories,
    note: `Categories are grouped by name across months. ${UNCATEGORISED} = expenses without a category.`,
  }
}

export function monthlyTotals(data: AppData, args: { from: string; to: string }) {
  const from = parseMonth(args.from).key
  const to = parseMonth(args.to).key
  if (from > to) throw new ToolError('from must not be after to.')
  const budgets = byKey(data)
  const months = listMonthKeys(budgets.keys(), data.importedTransactions)
    .filter((key) => key >= from && key <= to)
    .toSorted()
  return {
    months: months.map((key) => {
      const budget = budgets.get(key)
      const transactions = transactionsOfMonth(data, key)
      const summary = summarizeMonth(transactions, budget)
      const plan = budget ? calculateBudgetSummary(budget) : undefined
      return {
        month: key,
        plannedIncome: plan ? money(plan.incomeCents) : null,
        plannedExpenses: money(summary.plannedExpenseCents),
        received: money(summary.actualIncomeCents),
        spent: money(summary.actualExpenseCents),
        net: money(summary.actualIncomeCents - summary.actualExpenseCents),
        transfers: transactions.filter((transaction) => transaction.kind === 'transfer').length,
        uncategorisedExpenses: summary.unclassifiedCount,
        nonEuroCount: summary.nonEuroCount,
      }
    }),
  }
}

export interface MerchantArgs {
  from?: string
  to?: string
  kind?: ImportedTransactionKind
  uncategorizedOnly?: boolean
  limit?: number
  offset?: number
}

function tally(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  if (counts.size === 1) return values[0]!
  return `mixed: ${[...counts].toSorted((a, b) => b[1] - a[1]).map(([value, count]) => `${value} ${count}`).join(', ')}`
}

/** Transactions grouped by normalised description (case, accents and punctuation ignored). */
export function merchantSummary(data: AppData, args: MerchantArgs) {
  const from = dateBound(args.from, 'from')
  const to = dateBound(args.to, 'to')
  const index = categoryIndex(data)
  const groups = new Map<string, ImportedTransaction[]>()
  for (const transaction of data.importedTransactions) {
    if (!inDateRange(transaction.bookingDate, from, to)) continue
    if (args.kind && transaction.kind !== args.kind) continue
    if (args.uncategorizedOnly && !(transaction.kind === 'expense' && transaction.categoryId === null)) continue
    const key = merchantKey(transaction.description)
    groups.set(key, [...(groups.get(key) ?? []), transaction])
  }
  const merchants = [...groups.values()].map((transactions) => {
    const sorted = transactions.toSorted((a, b) => a.bookingDate.localeCompare(b.bookingDate))
    const euro = sorted.filter((transaction) => transaction.currency === 'EUR')
    const totalCents = euro.reduce((total, transaction) => total + transaction.amountCents, 0)
    return {
      description: sorted.at(-1)!.description,
      count: sorted.length,
      total: money(totalCents),
      kind: tally(sorted.map((transaction) => transaction.kind)),
      category: tally(sorted.map((transaction) =>
        transaction.kind === 'expense' ? categoryLabel(index, transaction.categoryId) : `(${transaction.kind})`)),
      firstDate: sorted[0]!.bookingDate,
      lastDate: sorted.at(-1)!.bookingDate,
      ...(euro.length < sorted.length ? { nonEuroCount: sorted.length - euro.length } : {}),
    }
  }).toSorted((a, b) => Math.abs(b.total.cents) - Math.abs(a.total.cents) || b.count - a.count)
  return paginate(merchants, args.limit, args.offset)
}
