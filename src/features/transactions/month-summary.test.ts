import { describe, expect, it } from 'vitest'
import { createEmptyBudgetMonth } from '@/domain/budget/factory'
import type { ImportedTransaction } from '@/domain/budget/models'
import { listMonthKeys, summarizeMonth } from './month-summary'

function transaction(
  overrides: Partial<ImportedTransaction>,
): ImportedTransaction {
  return {
    id: crypto.randomUUID(),
    provider: 'revolut-csv',
    sourceKey: crypto.randomUUID(),
    sourceReference: null,
    importBatchId: 'batch',
    sourceFileName: 'file.csv',
    bookingDate: '2026-03-10',
    startedAt: null,
    completedAt: null,
    description: 'Shop',
    amountCents: -1000,
    feeCents: 0,
    balanceCents: null,
    currency: 'EUR',
    transactionType: null,
    product: null,
    kind: 'expense',
    categoryId: null,
    importedAt: '2026-03-31T00:00:00.000Z',
    ...overrides,
  }
}

describe('summarizeMonth', () => {
  it('adds EUR expenses and fees, ignores other currencies and transfers', () => {
    const summary = summarizeMonth(
      [
        transaction({ amountCents: -1000, feeCents: 50 }),
        transaction({ amountCents: -2000, categoryId: 'cat' }),
        transaction({ amountCents: 250000, kind: 'income' }),
        transaction({ amountCents: -50000, kind: 'transfer' }),
        transaction({ amountCents: -900, currency: 'USD' }),
      ],
      undefined,
    )

    expect(summary).toEqual({
      actualExpenseCents: 3050,
      actualIncomeCents: 250000,
      plannedExpenseCents: 0,
      unclassifiedCount: 2,
      nonEuroCount: 1,
    })
  })

  it('has no planned amount without a budget and zero for an empty one', () => {
    const budget = createEmptyBudgetMonth(2026, 3)
    expect(summarizeMonth([], undefined).plannedExpenseCents).toBe(0)
    expect(summarizeMonth([], budget).plannedExpenseCents).toBe(0)
  })
})

describe('listMonthKeys', () => {
  it('merges budgets, transactions and extra keys, newest first', () => {
    expect(
      listMonthKeys(
        ['2026-02', '2026-03'],
        [transaction({ bookingDate: '2026-01-31' })],
        '2026-05',
      ),
    ).toEqual(['2026-05', '2026-03', '2026-02', '2026-01'])
  })
})
