import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CashFlowModel } from '@/domain/budget/chart-model'
import { formatMoney } from '@/domain/budget/money'

export function FlowSummary({ model }: { model: CashFlowModel }) {
  const names = new Map(model.nodes.map((node) => [node.id, node.name]))

  if (model.links.length === 0) return null

  return (
    <details className="border-t pt-2 text-sm">
      <summary className="flex min-h-11 w-fit cursor-pointer items-center text-xs font-semibold text-primary">
        Show accessible cash flow details
      </summary>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.links.map((link, index) => (
            <TableRow key={`${link.source}-${link.target}-${index}`}>
              <TableCell>{names.get(link.source) ?? link.source}</TableCell>
              <TableCell>{names.get(link.target) ?? link.target}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(link.value)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </details>
  )
}
