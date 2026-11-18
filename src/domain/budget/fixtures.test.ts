import { describe, expect, it } from 'vitest'
import {
  allocationUsagePercent,
  calculateBudgetSummary,
  type BudgetSummary,
} from './calculations'
import type { AppData, BudgetMonth } from './models'

// Contract fixtures shared with the Swift tests in ios/FinanceKit: both sides
// must produce the same `expected` from the same input.

interface Expected {
  summary: BudgetSummary
  accountUsagePercent: Array<number | null>
}

interface Fixture {
  description: string
  budgetMonth?: BudgetMonth
  appData?: AppData
  expected: Expected | Expected[]
}

const fixtures = import.meta.glob<Fixture>('../../../fixtures/domain/*.json', {
  eager: true,
  import: 'default',
})

function casesOf(fixture: Fixture): Array<[BudgetMonth, Expected]> {
  if (fixture.budgetMonth) {
    return [[fixture.budgetMonth, fixture.expected as Expected]]
  }
  const months = fixture.appData?.budgetMonths ?? []
  const expected = fixture.expected as Expected[]
  expect(expected).toHaveLength(months.length)
  return months.map((month, index) => [month, expected[index]!])
}

describe('shared domain fixtures', () => {
  it('finds the fixtures', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThan(0)
  })

  for (const [path, fixture] of Object.entries(fixtures)) {
    it(`matches ${path.split('/').pop()}`, () => {
      for (const [budget, expected] of casesOf(fixture)) {
        const summary = calculateBudgetSummary(budget)
        expect(summary).toEqual(expected.summary)
        expect(summary.accountAllocations.map(allocationUsagePercent)).toEqual(
          expected.accountUsagePercent,
        )
      }
    })
  }
})
