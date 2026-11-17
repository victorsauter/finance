import type { BudgetMonth } from './models'

export interface AccountAllocation {
  accountId: string
  accountName: string
  transferCents: number
  usageCents: number
  balanceCents: number
}

export interface BudgetSummary {
  incomeCents: number
  expenseCents: number
  remainingCents: number
  transferCents: number
  unallocatedIncomeCents: number
  savingsRate: number
  accountAllocations: AccountAllocation[]
  unassignedExpenseCents: number
}

/**
 * Share of an account's planned transfer that its expenses use, in percent.
 * Null when nothing is planned: dividing by a zero (or clamped) transfer used
 * to show absurd values such as "500000% used".
 */
export function allocationUsagePercent(
  allocation: Pick<AccountAllocation, 'transferCents' | 'usageCents'>,
): number | null {
  if (allocation.transferCents <= 0) return null
  return Math.round((allocation.usageCents / allocation.transferCents) * 100)
}

export function calculateBudgetSummary(budget: BudgetMonth): BudgetSummary {
  const incomeCents = budget.incomes.reduce(
    (total, income) => total + income.amountCents,
    0,
  )
  const expenseCents = budget.expenseCategories.reduce(
    (total, category) =>
      total +
      category.items.reduce(
        (categoryTotal, item) => categoryTotal + item.amountCents,
        0,
      ),
    0,
  )
  const transferCents = budget.accounts.reduce(
    (total, account) => total + account.plannedTransferCents,
    0,
  )
  const usageByAccount = new Map<string, number>()
  let unassignedExpenseCents = 0

  for (const category of budget.expenseCategories) {
    const categoryTotal = category.items.reduce(
      (total, item) => total + item.amountCents,
      0,
    )
    if (category.accountId) {
      usageByAccount.set(
        category.accountId,
        (usageByAccount.get(category.accountId) ?? 0) + categoryTotal,
      )
    } else {
      unassignedExpenseCents += categoryTotal
    }
  }

  const accountAllocations = budget.accounts.map((account) => {
    const usageCents = usageByAccount.get(account.id) ?? 0
    return {
      accountId: account.id,
      accountName: account.name,
      transferCents: account.plannedTransferCents,
      usageCents,
      balanceCents: account.plannedTransferCents - usageCents,
    }
  })

  const remainingCents = incomeCents - expenseCents
  return {
    incomeCents,
    expenseCents,
    remainingCents,
    transferCents,
    unallocatedIncomeCents: incomeCents - transferCents,
    savingsRate: incomeCents === 0 ? 0 : (remainingCents / incomeCents) * 100,
    accountAllocations,
    unassignedExpenseCents,
  }
}
