// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as read from '../src/readTools.ts'
import { FEB_HOUSING, FEB_SAVING, JAN_HOUSING, sampleData } from './support.ts'

describe('read tools', () => {
  const data = sampleData()

  it('lists months newest first with planned and spent totals', () => {
    const { months } = read.listMonths(data)
    expect(months.map((month) => month.month)).toEqual(['2026-02', '2026-01'])
    expect(months[0]).toMatchObject({ hasBudget: true, transactions: 5, uncategorisedExpenses: 2 })
    // 42.50 + (30.00 + 0.50 fee) + 0.25 fee on the income row; GBP row excluded.
    expect(months[0]!.spent).toEqual({ cents: 7325, formatted: '€73.25' })
  })

  it('returns a budget with ids, formatted amounts and the domain summary', () => {
    const budget = read.getBudget(data, { month: '2026-02' })
    expect(budget.categories.map((category) => category.id)).toEqual([FEB_HOUSING, FEB_SAVING])
    expect(budget.summary.income.formatted).toMatch(/^€/)
    expect(budget.categories[0]!.items[0]).toHaveProperty('amount.cents')
    expect(() => read.getBudget(data, { month: '2025-12' })).toThrow(/no budget for 2025-12.*2026-01, 2026-02/)
    expect(() => read.getBudget(data, { month: '2026-13' })).toThrow(/YYYY-MM/)
  })

  it('lists categories with their month', () => {
    expect(read.listCategories(data, { month: '2026-01' }).categories).toEqual([
      expect.objectContaining({ id: JAN_HOUSING, name: 'Housing', month: '2026-01' }),
    ])
    expect(read.listCategories(data, {}).categories).toHaveLength(3)
  })

  it('filters and paginates transactions', () => {
    const page = read.listTransactions(data, { limit: 2 })
    expect(page).toMatchObject({ total: 7, offset: 0, limit: 2, nextOffset: 2 })
    expect(page.items[0]!.date).toBe('2026-02-16')
    const last = read.listTransactions(data, { limit: 5, offset: 5 })
    expect(last.nextOffset).toBeNull()
    expect(last.items).toHaveLength(2)

    expect(read.listTransactions(data, { text: 'grocery store' }).total).toBe(3)
    expect(read.listTransactions(data, { month: '2026-01' }).total).toBe(2)
    expect(read.listTransactions(data, { from: '2026-02-14', to: '2026-02-15' }).total).toBe(2)
    expect(read.listTransactions(data, { category: 'housing' }).total).toBe(2)
    expect(read.listTransactions(data, { category: 'none', kind: 'expense' }).total).toBe(3)
    const transfer = read.listTransactions(data, { kind: 'transfer' }).items[0]!
    expect(transfer).toMatchObject({ kind: 'transfer', category: null, amount: { cents: -10000 } })
  })

  it('lists uncategorised expenses only', () => {
    const { items, total } = read.listUncategorized(data, { month: '2026-02' })
    expect(total).toBe(2)
    expect(items.every((item) => item.kind === 'expense' && item.categoryId === null)).toBe(true)
  })

  it('groups merchants by normalised description', () => {
    const page = read.merchantSummary(data, {})
    const grocery = page.items.find((merchant) => /grocery/i.test(merchant.description))!
    expect(grocery).toMatchObject({
      count: 3, total: { cents: -9250 }, kind: 'expense',
      category: 'mixed: (uncategorised) 2, Housing 1', firstDate: '2026-01-12', lastDate: '2026-02-14',
    })
    expect(page.items[0]!.description).toBe('To pocket Example savings')
    expect(read.merchantSummary(data, { uncategorizedOnly: true }).total).toBe(2)
    expect(read.merchantSummary(data, { limit: 1, offset: 1 })).toMatchObject({ total: 5, nextOffset: 2 })
  })

  it('computes spending by category following the web month summary', () => {
    const result = read.spendingByCategory(data, { from: '2026-01', to: '2026-02' })
    const byName = Object.fromEntries(result.categories.map((category) => [category.category, category]))
    expect(byName.Housing!.spent.cents).toBe(4250 + 700)
    expect(byName['(uncategorised)']!.spent.cents).toBe(2000 + 3050)
    expect(byName[read.FEES_ON_OTHER_KINDS]!.spent.cents).toBe(25)
    expect(byName['Saving goals']!.spent.cents).toBe(0)
    expect(result.total.cents).toBe(4950 + 5050 + 25)
    expect(result.nonEuroCount).toBe(1)
    expect(read.listMonths(data).months.reduce((sum, month) => sum + month.spent.cents, 0)).toBe(result.total.cents)
  })

  it('returns monthly totals in range', () => {
    const { months } = read.monthlyTotals(data, { from: '2026-01', to: '2026-02' })
    expect(months.map((month) => month.month)).toEqual(['2026-01', '2026-02'])
    expect(months[1]).toMatchObject({ received: { cents: 1234 }, spent: { cents: 7325 }, transfers: 1, nonEuroCount: 1 })
    expect(() => read.monthlyTotals(data, { from: '2026-03', to: '2026-01' })).toThrow(/after/)
  })
})
