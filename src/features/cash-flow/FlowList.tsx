import { groupFlowLinks } from '@/domain/budget/chart-layout'
import type { CashFlowModel, FlowNodeKind } from '@/domain/budget/chart-model'
import { formatMoney } from '@/domain/budget/money'

const barColors: Record<FlowNodeKind, string> = {
  income: 'bg-flow-income',
  budget: 'bg-flow-budget',
  account: 'bg-flow-account',
  expense: 'bg-flow-expense',
  saving: 'bg-flow-saving',
  warning: 'bg-flow-warning',
}

/** Phone-sized version of the cash flow: one block per source, bars for share. */
export function FlowList({ model }: { model: CashFlowModel }) {
  const groups = groupFlowLinks(model)

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section data-kind={group.source.kind} key={group.source.id}>
          <h3 className="mb-2 flex items-baseline justify-between gap-3 text-sm font-semibold">
            <span className="min-w-0 wrap-anywhere">{group.source.name}</span>
            <span className="tabular-nums">{formatMoney(group.total)}</span>
          </h3>
          <ul className="grid gap-1">
            {group.items.map((item) => (
              <li
                key={item.node.id}
                data-kind={item.node.kind}
                className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md border bg-muted/40 px-3 pt-2 pb-3 text-sm"
              >
                <span className="min-w-0 wrap-anywhere">{item.node.name}</span>
                <span className="font-semibold text-muted-foreground tabular-nums">
                  {formatMoney(item.value)}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 bottom-1 h-1"
                >
                  <span
                    className={`block h-full rounded-full ${barColors[item.node.kind]}`}
                    style={{ width: `${Math.max(2, item.share * 100)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
