import { describe, expect, it } from 'vitest'
import { calculateBudgetSummary } from './calculations'
import { createEmptyBudgetMonth } from './factory'

describe('calculateBudgetSummary', () => {
  it('calculates totals, allocation balances, and savings rate in cents', () => {
    const budget = createEmptyBudgetMonth(2026, 9)
    budget.incomes[0]!.amountCents = 300_000
    budget.accounts[0]!.plannedTransferCents = 200_000
    budget.expenseCategories[0]!.items[0]!.amountCents = 150_000

    const summary = calculateBudgetSummary(budget)

    expect(summary.incomeCents).toBe(300_000)
    expect(summary.expenseCents).toBe(150_000)
    expect(summary.remainingCents).toBe(150_000)
    expect(summary.unallocatedIncomeCents).toBe(100_000)
    expect(summary.savingsRate).toBe(50)
    expect(summary.accountAllocations[0]!.balanceCents).toBe(50_000)
  })

  it('allows deficits and reports unassigned expenses', () => {
    const budget = createEmptyBudgetMonth(2026, 9)
    budget.incomes[0]!.amountCents = 100_00
    budget.expenseCategories[0]!.accountId = null
    budget.expenseCategories[0]!.items[0]!.amountCents = 125_00

    const summary = calculateBudgetSummary(budget)

    expect(summary.remainingCents).toBe(-25_00)
    expect(summary.savingsRate).toBe(-25)
    expect(summary.unassignedExpenseCents).toBe(125_00)
  })

  it('returns a zero savings rate for a budget without income', () => {
    const budget = createEmptyBudgetMonth(2026, 9)
    expect(calculateBudgetSummary(budget).savingsRate).toBe(0)
  })
})
