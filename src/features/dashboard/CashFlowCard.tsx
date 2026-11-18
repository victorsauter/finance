import { Section } from '@/components/layout/Section'
import type { CashFlowModel } from '@/domain/budget/chart-model'
import { CashFlowChart } from '../cash-flow/CashFlowChart'
import { FlowSummary } from '../cash-flow/FlowSummary'

export function CashFlowCard({ model }: { model: CashFlowModel }) {
  return (
    <Section
      title="Cash flow"
      actions={
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="h-1 w-6 rounded-full bg-brand opacity-70"
          />
          Width = amount
        </p>
      }
      contentClassName="flex flex-col gap-4"
    >
      <CashFlowChart model={model} />
      <FlowSummary model={model} />
    </Section>
  )
}
