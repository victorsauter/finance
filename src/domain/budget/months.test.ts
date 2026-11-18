import { describe, expect, it } from 'vitest'
import {
  createEmptyBudgetMonth,
  createInitialAppData,
  findBudget,
  monthKey,
  previousMonth,
  seedMonthFrom,
} from './factory'
import type { AppData, BudgetMonth } from './models'
import { parseAppData } from './schema'

function dataWithMonths(...months: Array<[number, number, number]>): AppData {
  const data = createInitialAppData(new Date(2026, 0, 1))
  data.budgetMonths = months.map(([year, month, income]) => {
    const budget = createEmptyBudgetMonth(year, month)
    budget.incomes[0]!.amountCents = income
    return budget
  })
  data.settings.activeBudgetMonthId = data.budgetMonths[0]!.id
  return data
}

function collectIds(budget: BudgetMonth): string[] {
  return [
    budget.id,
    ...budget.incomes.map((item) => item.id),
    ...budget.accounts.map((item) => item.id),
    ...budget.expenseCategories.flatMap((category) => [
      category.id,
      ...category.items.map((item) => item.id),
    ]),
  ]
}

describe('month helpers', () => {
  it('formats month keys', () => {
    expect(monthKey(2026, 3)).toBe('2026-03')
    expect(monthKey(2026, 12)).toBe('2026-12')
  })

  it('computes the previous month across years', () => {
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 })
    expect(previousMonth(2026, 5)).toEqual({ year: 2026, month: 4 })
  })

  it('finds a budget by year and month', () => {
    const data = dataWithMonths([2026, 1, 100], [2026, 3, 300])
    expect(findBudget(data, 2026, 3)?.incomes[0]!.amountCents).toBe(300)
    expect(findBudget(data, 2026, 2)).toBeUndefined()
  })
})

describe('seedMonthFrom', () => {
  it('copies the nearest earlier month, skipping gaps', () => {
    const data = dataWithMonths([2026, 1, 100], [2026, 3, 300], [2026, 9, 900])
    const seeded = seedMonthFrom(data, 2026, 6)

    expect(seeded.year).toBe(2026)
    expect(seeded.month).toBe(6)
    expect(seeded.name).toBe('June 2026')
    expect(seeded.incomes[0]!.amountCents).toBe(300)
  })

  it('ignores later months and works across a year boundary', () => {
    const data = dataWithMonths([2025, 11, 1100], [2026, 8, 800])
    expect(seedMonthFrom(data, 2026, 2).incomes[0]!.amountCents).toBe(1100)
  })

  it('does not copy the requested month itself', () => {
    const data = dataWithMonths([2026, 1, 100], [2026, 3, 300])
    expect(seedMonthFrom(data, 2026, 3).incomes[0]!.amountCents).toBe(100)
  })

  it('falls back to an empty month when nothing precedes it', () => {
    const data = dataWithMonths([2026, 8, 800])
    const seeded = seedMonthFrom(data, 2026, 1)

    expect(seeded.incomes[0]!.amountCents).toBe(0)
    expect(seeded.name).toBe('January 2026')
  })

  it('regenerates every identifier and remaps accounts', () => {
    const data = dataWithMonths([2026, 1, 100])
    const source = data.budgetMonths[0]!
    const seeded = seedMonthFrom(data, 2026, 2)

    const sourceIds = new Set(collectIds(source))
    expect(collectIds(seeded).some((id) => sourceIds.has(id))).toBe(false)
    expect(seeded.expenseCategories[0]!.accountId).toBe(seeded.accounts[0]!.id)
  })

  it('produces data that survives a schema round-trip', () => {
    const data = dataWithMonths([2026, 1, 100])
    data.budgetMonths.push(seedMonthFrom(data, 2026, 5))
    expect(parseAppData(data)).toEqual(data)
  })
})
