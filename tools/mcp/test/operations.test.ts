// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseAppData } from '../../../src/domain/budget/schema.ts'
import * as op from '../src/operations.ts'
import { FEB_GROCERY_TX, FEB_HOUSING, FEB_REFUND_TX, FEB_SAVING, JAN_HOUSING, sampleData } from './support.ts'

const NOW = '2026-11-18T12:00:00.000Z'

describe('transaction operations', () => {
  it('sets a category without touching the input', () => {
    const data = sampleData()
    const before = structuredClone(data)
    const result = op.setTransactionCategory(data, ['00000000-0000-4000-8000-000000000202'], FEB_SAVING)
    expect(data).toEqual(before)
    expect(result.changedCount).toBe(1)
    expect(result.lines[0]).toMatch(/Example grocery store.*\(uncategorised\) -> Saving goals/)
    expect(result.next.importedTransactions.find((t) => t.id.endsWith('202'))!.categoryId).toBe(FEB_SAVING)
    expect(() => parseAppData(result.next)).not.toThrow()
  })

  it('rejects unknown ids, unknown categories and categories of another month', () => {
    const data = sampleData()
    expect(() => op.setTransactionCategory(data, [FEB_GROCERY_TX, 'nope'], FEB_SAVING)).toThrow(/Unknown transaction id.*nope/)
    expect(() => op.setTransactionCategory(data, [FEB_GROCERY_TX], '00000000-0000-4000-8000-000000000999')).toThrow(/Unknown category/)
    expect(() => op.setTransactionCategory(data, ['00000000-0000-4000-8000-000000000201', FEB_GROCERY_TX], FEB_HOUSING))
      .toThrow(/201 is in 2026-01 but category .* belongs to 2026-02/)
    expect(() => op.setTransactionCategory(data, [FEB_REFUND_TX], FEB_HOUSING)).toThrow(/only expenses/)
  })

  it('reports no change when the value is already set', () => {
    expect(op.setTransactionCategory(sampleData(), [FEB_GROCERY_TX], FEB_HOUSING).changes).toEqual([])
  })

  it('sets kind and clears the category of non-expenses', () => {
    const result = op.setTransactionKind(sampleData(), [FEB_GROCERY_TX], 'transfer')
    const changed = result.next.importedTransactions.find((t) => t.id === FEB_GROCERY_TX)!
    expect(changed).toMatchObject({ kind: 'transfer', categoryId: null })
    expect(result.changes.map((change) => change.field)).toEqual(['kind', 'category'])
    expect(result.changedCount).toBe(1)
  })
})

describe('categorize_by_description', () => {
  it('resolves the category by name in each transaction month and groups the diff by merchant', () => {
    const result = op.categorizeByDescription(sampleData(), [{ description: 'example grocery store', categoryName: 'housing' }], {
      from: '2026-01', to: '2026-02',
    })
    const ids = Object.fromEntries(result.next.importedTransactions.map((t) => [t.id.slice(-3), t.categoryId]))
    expect(ids['201']).toBe(JAN_HOUSING)
    expect(ids['202']).toBe(FEB_HOUSING)
    expect(result.changedCount).toBe(2)
    expect(result.lines).toEqual(['Example grocery store: 2 transaction(s), -€50.00, 2026-01..2026-02: (uncategorised) -> Housing'])
  })

  it('maps a categoryId to its name, then resolves per month', () => {
    const result = op.categorizeByDescription(sampleData(), [{ description: 'Example grocery store', categoryId: FEB_HOUSING }], {
      from: '2026-01-01', to: '2026-02-28',
    })
    expect(result.next.importedTransactions.find((t) => t.id.endsWith('201'))!.categoryId).toBe(JAN_HOUSING)
  })

  it('applies nothing and lists the months where the category is missing', () => {
    expect(() => op.categorizeByDescription(sampleData(), [{ description: 'Example grocery store', categoryName: 'Saving goals' }], {
      from: '2026-01', to: '2026-02',
    })).toThrow(/Nothing changed.*\n- 2026-01: no category named "Saving goals"/)
  })

  it('keeps existing categories unless overwrite, and skips non-expenses', () => {
    const kept = op.categorizeByDescription(sampleData(), [{ description: 'Example grocery store', categoryName: 'Saving goals' }], {
      from: '2026-02', to: '2026-02',
    })
    expect(kept.changedCount).toBe(1)
    expect(kept.notes[0]).toMatch(/1 transaction\(s\) already in another category kept/)
    const replaced = op.categorizeByDescription(sampleData(), [{ description: 'Example grocery store', categoryName: 'Saving goals' }], {
      from: '2026-02', to: '2026-02', overwrite: true,
    })
    expect(replaced.changedCount).toBe(2)
    const transfer = op.categorizeByDescription(sampleData(), [{ description: 'To pocket Example savings', categoryName: 'Saving goals' }], {
      from: '2026-02', to: '2026-02',
    })
    expect(transfer.changes).toEqual([])
    expect(transfer.notes[0]).toMatch(/income\/transfer/)
  })

  it('fails when a description matches nothing', () => {
    expect(() => op.categorizeByDescription(sampleData(), [{ description: 'Unknown shop', categoryName: 'Housing' }], {
      from: '2026-01', to: '2026-02',
    })).toThrow(/no transaction .* matches "Unknown shop"/)
  })
})

describe('set_kind_by_description', () => {
  it('marks matching rows as transfers and groups the diff', () => {
    const result = op.setKindByDescription(sampleData(), [{ description: 'example grocery store', kind: 'transfer' }], {
      from: '2026-01', to: '2026-02',
    })
    expect(result.changedCount).toBe(3)
    expect(result.lines).toEqual(['Example grocery store: 3 transaction(s), -€92.50, 2026-01..2026-02: expense -> transfer'])
    expect(result.next.importedTransactions.filter((t) => t.kind === 'transfer' && t.categoryId === null)).toHaveLength(4)
  })
})

describe('budget operations', () => {
  const feb = () => sampleData().budgetMonths.find((budget) => budget.month === 2)!
  const rentId = () => feb().expenseCategories[0]!.items[0]!.id

  it('sets a planned amount and moves updatedAt', () => {
    const result = op.setPlannedAmount(sampleData(), '2026-02', rentId(), 123456, NOW)
    const budget = result.next.budgetMonths.find((b) => b.month === 2)!
    expect(budget.expenseCategories[0]!.items[0]!.amountCents).toBe(123456)
    expect(budget.updatedAt).toBe(NOW)
    expect(result.lines[0]).toMatch(/2026-02 Housing \/ Rent \[planned\]: .* -> €1,234.56/)
    expect(() => op.setPlannedAmount(sampleData(), '2026-02', rentId(), -1)).toThrow(/whole number/)
    expect(() => op.setPlannedAmount(sampleData(), '2026-01', rentId(), 1)).toThrow(/No expense item/)
  })

  it('adds, renames and deletes items with resequenced order', () => {
    const added = op.addExpenseItem(sampleData(), '2026-02', FEB_HOUSING, '  Internet ', 3000, NOW)
    const items = added.next.budgetMonths.find((b) => b.month === 2)!.expenseCategories[0]!.items
    expect(items.at(-1)).toMatchObject({ name: 'Internet', amountCents: 3000, sortOrder: items.length - 1 })
    expect(() => parseAppData(added.next)).not.toThrow()
    expect(() => op.addExpenseItem(sampleData(), '2026-01', FEB_HOUSING, 'X', 0)).toThrow(/No category/)

    const renamed = op.renameItem(sampleData(), '2026-02', FEB_HOUSING, 'Home', NOW)
    expect(renamed.lines[0]).toBe('2026-02 category [name]: Housing -> Home')
    expect(() => op.renameItem(sampleData(), '2026-02', FEB_HOUSING, '   ')).toThrow(/1 to 200/)

    const deleted = op.deleteItem(sampleData(), '2026-02', rentId(), NOW)
    const left = deleted.next.budgetMonths.find((b) => b.month === 2)!.expenseCategories[0]!.items
    expect(left.map((item) => item.sortOrder)).toEqual([0])
    expect(() => op.deleteItem(sampleData(), '2026-02', FEB_HOUSING)).toThrow(/No expense item/)
  })
})
