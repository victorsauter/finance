import type { CashFlowModel } from '../../domain/budget/chart-model'
import { formatMoney } from '../../domain/budget/money'

export function FlowSummary({ model }: { model: CashFlowModel }) {
  const names = new Map(model.nodes.map((node) => [node.id, node.name]))

  if (model.links.length === 0) return null

  return (
    <details className="flow-summary">
      <summary>Show accessible cash flow details</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {model.links.map((link, index) => (
              <tr key={`${link.source}-${link.target}-${index}`}>
                <td>{names.get(link.source) ?? link.source}</td>
                <td>{names.get(link.target) ?? link.target}</td>
                <td>{formatMoney(link.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
