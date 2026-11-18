import type { BudgetMonth, ImportedTransaction } from '@/domain/budget/models'

export interface MonthSummary {
  /** EUR expenses including fees. */
  actualExpenseCents: number
  actualIncomeCents: number
  plannedExpenseCents: number
  /** Expenses without a category. */
  unclassifiedCount: number
  /** Transactions excluded from the EUR totals. */
  nonEuroCount: number
}

/** Totals shown above the transactions table for one month. */
export function summarizeMonth(
  transactions: readonly ImportedTransaction[],
  budget: BudgetMonth | undefined,
): MonthSummary {
  const euroTransactions = transactions.filter(
    (transaction) => transaction.currency === 'EUR',
  )
  const actualExpenseCents = euroTransactions.reduce(
    (total, transaction) =>
      total +
      transaction.feeCents +
      (transaction.kind === 'expense' && transaction.amountCents < 0
        ? -transaction.amountCents
        : 0),
    0,
  )
  const actualIncomeCents = euroTransactions.reduce(
    (total, transaction) =>
      transaction.kind === 'income' && transaction.amountCents > 0
        ? total + transaction.amountCents
        : total,
    0,
  )
  const plannedExpenseCents =
    budget?.expenseCategories.reduce(
      (categoryTotal, category) =>
        categoryTotal +
        category.items.reduce(
          (itemTotal, item) => itemTotal + item.amountCents,
          0,
        ),
      0,
    ) ?? 0
  const unclassifiedCount = transactions.filter(
    (transaction) =>
      transaction.kind === 'expense' && transaction.categoryId === null,
  ).length

  return {
    actualExpenseCents,
    actualIncomeCents,
    plannedExpenseCents,
    unclassifiedCount,
    nonEuroCount: transactions.length - euroTransactions.length,
  }
}

/** Months that have a budget or at least one transaction, newest first. */
export function listMonthKeys(
  budgetMonthKeys: Iterable<string>,
  transactions: readonly ImportedTransaction[],
  ...extra: string[]
): string[] {
  const keys = new Set<string>([...budgetMonthKeys, ...extra])
  transactions.forEach((transaction) =>
    keys.add(transaction.bookingDate.slice(0, 7)),
  )
  return [...keys].sort().reverse()
}
