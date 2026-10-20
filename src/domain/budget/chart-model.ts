import type { BudgetMonth } from './models'
import { calculateBudgetSummary } from './calculations'

export type FlowNodeKind =
  | 'income'
  | 'budget'
  | 'account'
  | 'expense'
  | 'saving'
  | 'warning'

export interface FlowNode {
  id: string
  name: string
  kind: FlowNodeKind
}

export interface FlowLink {
  source: string
  target: string
  value: number
}

export interface CashFlowModel {
  nodes: FlowNode[]
  links: FlowLink[]
}

export function buildCashFlowModel(budget: BudgetMonth): CashFlowModel {
  const nodes: FlowNode[] = []
  const links: FlowLink[] = []
  const nodeIds = new Set<string>()
  const addNode = (node: FlowNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id)
      nodes.push(node)
    }
  }

  addNode({ id: 'budget', name: 'Household budget', kind: 'budget' })

  for (const income of budget.incomes) {
    if (income.amountCents <= 0) continue
    const id = `income:${income.id}`
    addNode({ id, name: income.name, kind: 'income' })
    links.push({ source: id, target: 'budget', value: income.amountCents })
  }

  for (const account of budget.accounts) {
    const id = `account:${account.id}`
    addNode({ id, name: account.name, kind: 'account' })
    if (account.plannedTransferCents > 0) {
      links.push({
        source: 'budget',
        target: id,
        value: account.plannedTransferCents,
      })
    }
  }

  for (const category of budget.expenseCategories) {
    const source = category.accountId
      ? `account:${category.accountId}`
      : 'unassigned'
    if (!category.accountId) {
      addNode({
        id: 'unassigned',
        name: 'Unassigned expenses',
        kind: 'warning',
      })
    }

    for (const item of category.items) {
      if (item.amountCents <= 0) continue
      const target = `expense:${category.id}:${item.id}`
      addNode({ id: target, name: item.name, kind: 'expense' })
      links.push({ source, target, value: item.amountCents })
    }
  }

  const summary = calculateBudgetSummary(budget)
  if (summary.unallocatedIncomeCents > 0) {
    addNode({
      id: 'unallocated',
      name: 'Unallocated / savings',
      kind: 'saving',
    })
    links.push({
      source: 'budget',
      target: 'unallocated',
      value: summary.unallocatedIncomeCents,
    })
  }

  for (const allocation of summary.accountAllocations) {
    if (allocation.balanceCents <= 0) continue
    const id = `balance:${allocation.accountId}`
    addNode({
      id,
      name: `Solde ${allocation.accountName}`,
      kind: 'saving',
    })
    links.push({
      source: `account:${allocation.accountId}`,
      target: id,
      value: allocation.balanceCents,
    })
  }

  return { nodes, links }
}
