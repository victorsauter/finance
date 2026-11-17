import { useCallback, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { DownloadIcon } from 'lucide-react'
import { useBudget } from '@/app/budget-context'
import { Page } from '@/components/layout/Page'
import { PageHeader } from '@/components/layout/PageHeader'
import { Section } from '@/components/layout/Section'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-context'
import { NativeSelect } from '@/components/ui/native-select'
import { findBudget, monthKey } from '@/domain/budget/factory'
import type { ImportedTransaction } from '@/domain/budget/models'
import { formatMoney } from '@/domain/budget/money'
import { formatMonthKey } from '@/domain/transactions/format'
import { cn } from '@/lib/utils'
import { listMonthKeys, summarizeMonth } from './month-summary'
import { Notice } from './Notice'
import { RevolutCsvImporter } from './RevolutCsvImporter'
import { TransactionsTable } from './TransactionsTable'

interface TransactionsPageProps {
  /** Month from the `m` search param (`YYYY-MM`); absent means the active month. */
  month?: string
  onMonthChange: (month: string) => void
}

interface SummaryTileProps {
  label: string
  value: string
  hint: string
  tone?: 'default' | 'negative' | 'attention'
}

function SummaryTile({ label, value, hint, tone = 'default' }: SummaryTileProps) {
  return (
    <Card
      size="sm"
      role="article"
      aria-label={label}
      className={cn(
        'shadow-card',
        tone === 'negative' && 'ring-destructive/40',
        tone === 'attention' && 'ring-warning/50',
      )}
    >
      <CardContent className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <strong
          className={cn(
            'font-heading text-xl font-semibold tabular-nums',
            tone === 'negative' && 'text-destructive',
            tone === 'attention' && 'text-warning',
          )}
        >
          {value}
        </strong>
        <small className="text-xs text-muted-foreground">{hint}</small>
      </CardContent>
    </Card>
  )
}

export function TransactionsPage({
  month,
  onMonthChange,
}: TransactionsPageProps) {
  const {
    data,
    activeBudget,
    setTransactionCategory,
    setTransactionKind,
    deleteTransaction,
  } = useBudget()
  const confirm = useConfirm()

  const selectedMonth = month ?? monthKey(activeBudget.year, activeBudget.month)
  const [selectedYear, selectedMonthNumber] = selectedMonth
    .split('-')
    .map(Number) as [number, number]

  const months = useMemo(
    () =>
      listMonthKeys(
        data.budgetMonths.map((budget) =>
          monthKey(budget.year, budget.month),
        ),
        data.importedTransactions,
        selectedMonth,
      ),
    [data.budgetMonths, data.importedTransactions, selectedMonth],
  )

  const budget = findBudget(data, selectedYear, selectedMonthNumber)
  const transactions = useMemo(
    () =>
      data.importedTransactions.filter((transaction) =>
        transaction.bookingDate.startsWith(selectedMonth),
      ),
    [data.importedTransactions, selectedMonth],
  )
  const summary = summarizeMonth(transactions, budget)
  const monthLabel = formatMonthKey(selectedMonth)

  const removeTransaction = useCallback(
    (transaction: ImportedTransaction) => {
      void (async () => {
        const confirmed = await confirm({
          title: 'Delete this transaction?',
          message: `“${transaction.description}” from ${transaction.bookingDate} will be removed.`,
          confirmLabel: 'Delete',
          tone: 'danger',
        })
        if (confirmed) deleteTransaction(transaction.id)
      })()
    },
    [confirm, deleteTransaction],
  )

  return (
    <Page>
      <PageHeader
        eyebrow="Actual expenses"
        title="Revolut transactions"
        description="Import a CSV statement, review the new rows, then assign expenses to categories in the matching budget."
        actions={
          <label className="flex w-full flex-col gap-1 text-xs font-medium text-muted-foreground sm:w-56">
            Displayed month
            <NativeSelect
              aria-label="Transaction month"
              className="md:h-9"
              value={selectedMonth}
              onChange={(event) => onMonthChange(event.target.value)}
            >
              {months.map((key) => (
                <option key={key} value={key}>
                  {formatMonthKey(key)}
                </option>
              ))}
            </NativeSelect>
          </label>
        }
      />

      <RevolutCsvImporter onImported={onMonthChange} />

      <section
        aria-label={`Transaction summary for ${monthLabel}`}
        className="@container"
      >
        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-4">
          <SummaryTile
            label="Actual expenses"
            value={formatMoney(summary.actualExpenseCents)}
            hint="EUR transactions classified as expenses, including fees"
          />
          <SummaryTile
            label="Planned budget"
            value={formatMoney(summary.plannedExpenseCents)}
            hint={budget ? budget.name : 'No budget for this month'}
          />
          <SummaryTile
            label="Available difference"
            value={formatMoney(
              summary.plannedExpenseCents - summary.actualExpenseCents,
            )}
            hint="Planned minus actual expenses"
            tone={
              summary.actualExpenseCents > summary.plannedExpenseCents
                ? 'negative'
                : 'default'
            }
          />
          <SummaryTile
            label="To classify"
            value={String(summary.unclassifiedCount)}
            hint={
              summary.actualIncomeCents > 0
                ? `${formatMoney(summary.actualIncomeCents)} of EUR income`
                : 'No EUR income'
            }
            tone={summary.unclassifiedCount > 0 ? 'attention' : 'default'}
          />
        </div>
      </section>

      {summary.nonEuroCount > 0 && (
        <Notice tone="warning" title="Multiple currencies">
          {summary.nonEuroCount}{' '}
          {summary.nonEuroCount === 1
            ? 'transaction is'
            : 'transactions are'}{' '}
          excluded from EUR totals. The original amount remains visible below.
        </Notice>
      )}

      {!budget && transactions.length > 0 && (
        <Notice
          tone="warning"
          title={`No budget for ${monthLabel}`}
          action={
            <Link
              to="/"
              search={{ m: selectedMonth }}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'h-11 md:h-9',
              )}
            >
              Open this month
            </Link>
          }
        >
          Transactions are retained, but their categories can only be assigned
          once this month has a budget.
        </Notice>
      )}

      <Section
        title={monthLabel}
        description={`${transactions.length} ${
          transactions.length === 1 ? 'transaction' : 'transactions'
        } imported`}
      >
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <DownloadIcon className="size-5" />
            </div>
            <h3 className="font-heading font-semibold">
              No transactions for this month
            </h3>
            <p className="max-w-prose text-sm text-muted-foreground">
              Choose a Revolut CSV export. Previously imported files can be
              selected again without creating duplicates.
            </p>
          </div>
        ) : (
          <TransactionsTable
            transactions={transactions}
            budget={budget}
            onCategoryChange={setTransactionCategory}
            onKindChange={setTransactionKind}
            onDelete={removeTransaction}
          />
        )}
      </Section>
    </Page>
  )
}
