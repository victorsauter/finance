import { groupFlowLinks } from '../../domain/budget/chart-layout'
import type { CashFlowModel } from '../../domain/budget/chart-model'
import { formatMoney } from '../../domain/budget/money'

/** Phone-sized version of the cash flow: one block per source, bars for share. */
export function FlowList({ model }: { model: CashFlowModel }) {
  const groups = groupFlowLinks(model)

  return (
    <div className="flow-list">
      {groups.map((group) => (
        <section
          className="flow-group"
          data-kind={group.source.kind}
          key={group.source.id}
        >
          <h3>
            <span>{group.source.name}</span>
            <span className="flow-amount">{formatMoney(group.total)}</span>
          </h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.node.id} data-kind={item.node.kind}>
                <span className="flow-name">{item.node.name}</span>
                <span className="flow-amount">{formatMoney(item.value)}</span>
                <span
                  className="flow-bar"
                  aria-hidden="true"
                  style={{ width: `${Math.max(2, item.share * 100)}%` }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
