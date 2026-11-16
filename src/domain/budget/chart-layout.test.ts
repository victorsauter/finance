import { describe, expect, it } from 'vitest'
import { buildCashFlowModel, type FlowNode } from './chart-model'
import {
  groupFlowLinks,
  sankeyHeight,
  truncateLabel,
} from './chart-layout'
import { createEmptyBudgetMonth } from './factory'

const node = (id: string, kind: FlowNode['kind']): FlowNode => ({
  id,
  name: id,
  kind,
})

describe('sankeyHeight', () => {
  it('stays compact for a sparse budget', () => {
    expect(sankeyHeight([node('a', 'income'), node('b', 'budget')])).toBe(300)
  })

  it('grows with the busiest column and is capped', () => {
    const expenses = Array.from({ length: 8 }, (_, i) => node(`e${i}`, 'expense'))
    expect(sankeyHeight(expenses)).toBe(8 * 46 + 60)

    const many = Array.from({ length: 40 }, (_, i) => node(`e${i}`, 'expense'))
    expect(sankeyHeight(many)).toBe(640)
  })
})

describe('truncateLabel', () => {
  it('keeps short labels and shortens long ones to the limit', () => {
    expect(truncateLabel('Rent', 10)).toBe('Rent')
    const cut = truncateLabel('Rent and mortgage payments', 10)
    expect(cut.length).toBeLessThanOrEqual(10)
    expect(cut.endsWith('…')).toBe(true)
  })
})

describe('groupFlowLinks', () => {
  it('groups outgoing links by source with their share of the total', () => {
    const budget = createEmptyBudgetMonth(2026, 9)
    budget.incomes[0]!.amountCents = 300_00
    budget.accounts[0]!.plannedTransferCents = 200_00

    const groups = groupFlowLinks(buildCashFlowModel(budget))
    const household = groups.find((group) => group.source.id === 'budget')!

    expect(household.total).toBe(300_00)
    expect(household.items.map((item) => item.value).sort()).toEqual([
      100_00, 200_00,
    ])
    expect(household.items.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1)
    expect(groups.every((group) => group.items.length > 0)).toBe(true)
  })

  it('returns nothing for an empty model', () => {
    expect(groupFlowLinks({ nodes: [], links: [] })).toEqual([])
  })
})
