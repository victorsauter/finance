import type { CashFlowModel, FlowNode } from './chart-model'

/**
 * Below this container width (the chart card, not the screen) the Sankey is
 * replaced by a vertical flow list. Four columns need about 170px each for
 * their labels; the desktop chart column is ~550px wide.
 */
export const SANKEY_MIN_WIDTH = 520

const MIN_HEIGHT = 300
const MAX_HEIGHT = 640
const ROW_HEIGHT = 46

/**
 * Height for the Sankey: tall enough for the busiest column, never the huge
 * fixed size a sparse budget used to get. Nodes are grouped the way d3 lays
 * them out: expenses share a column with unassigned expenses, accounts with
 * their remaining balances.
 */
export function sankeyHeight(nodes: FlowNode[]): number {
  const columns = { income: 0, budget: 0, account: 0, expense: 0 }
  for (const node of nodes) {
    if (node.kind === 'income') columns.income++
    else if (node.kind === 'budget') columns.budget++
    else if (node.kind === 'account' || node.kind === 'saving') columns.account++
    else columns.expense++
  }
  const busiest = Math.max(...Object.values(columns), 1)
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, busiest * ROW_HEIGHT + 60))
}

/** Shortens a label to `maxChars`, ending with an ellipsis when it was cut. */
export function truncateLabel(name: string, maxChars: number): string {
  if (name.length <= maxChars) return name
  return `${name.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

export interface FlowListItem {
  node: FlowNode
  value: number
  /** Share of the source total, from 0 to 1. */
  share: number
}

export interface FlowListGroup {
  source: FlowNode
  total: number
  items: FlowListItem[]
}

/** Groups links by source so a flow can be read top to bottom on a phone. */
export function groupFlowLinks(model: CashFlowModel): FlowListGroup[] {
  const nodes = new Map(model.nodes.map((node) => [node.id, node]))
  const groups: FlowListGroup[] = []

  for (const source of model.nodes) {
    const outgoing = model.links.filter((link) => link.source === source.id)
    if (outgoing.length === 0) continue
    const total = outgoing.reduce((sum, link) => sum + link.value, 0)
    const items = outgoing.flatMap((link) => {
      const node = nodes.get(link.target)
      return node ? [{ node, value: link.value, share: link.value / total }] : []
    })
    groups.push({ source, total, items })
  }
  return groups
}
