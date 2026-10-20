import { describe, expect, it } from 'vitest'
import { buildCashFlowModel } from './chart-model'
import { createEmptyBudgetMonth } from './factory'

describe('buildCashFlowModel', () => {
  it('omits zero-value links and uses stable identifiers', () => {
    const budget = createEmptyBudgetMonth(2026, 9)
    expect(buildCashFlowModel(budget).links).toHaveLength(0)

    budget.incomes[0]!.amountCents = 200_00
    budget.accounts[0]!.plannedTransferCents = 150_00
    budget.expenseCategories[0]!.items[0]!.amountCents = 100_00

    const model = buildCashFlowModel(budget)
    expect(model.links.every((link) => link.value > 0)).toBe(true)
    expect(model.nodes.some((node) => node.id === 'unallocated')).toBe(true)
    expect(model.nodes.some((node) => node.id.startsWith('balance:'))).toBe(
      true,
    )
  })
})
