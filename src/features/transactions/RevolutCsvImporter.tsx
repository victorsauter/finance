import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { FileUp, RotateCcw, X } from 'lucide-react'
import { useBudget } from '@/app/budget-context'
import { Section } from '@/components/layout/Section'
import { Button } from '@/components/ui/button'
import type { ImportedTransaction } from '@/domain/budget/models'
import { formatTransactionAmount } from '@/domain/transactions/format'
import {
  parseRevolutCsv,
  type RevolutCsvIssueReason,
  type RevolutCsvResult,
} from '@/domain/transactions/revolut-csv'
import { Notice } from '@/components/ui/notice'

const PREVIEW_ROW_LIMIT = 8
const ISSUE_LIMIT = 20
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

interface ImportPreview {
  fileName: string
  result: RevolutCsvResult
  newTransactions: ImportedTransaction[]
  existingDuplicateCount: number
}

interface LastImport {
  batchId: string
  count: number
}

const kindLabels = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
} as const

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

export function RevolutCsvImporter({
  onImported,
}: {
  onImported: (monthKey: string) => void
}) {
  const { data, importTransactions, deleteTransactionBatch } = useBudget()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [lastImport, setLastImport] = useState<LastImport | null>(null)

  const issueCounts = useMemo(() => {
    const counts: Record<RevolutCsvIssueReason, number> = {
      duplicate: 0,
      invalid: 0,
      pending: 0,
      rejected: 0,
    }
    preview?.result.issues.forEach((issue) => {
      counts[issue.reason] += 1
    })
    return counts
  }, [preview])

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setPreview(null)
    setLastImport(null)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setIsError(true)
      setMessage('The file exceeds the 10 MB limit.')
      return
    }

    try {
      const result = parseRevolutCsv(await file.text(), {
        fileName: file.name,
      })
      const existingKeys = new Set(
        data.importedTransactions.map((transaction) => transaction.sourceKey),
      )
      const newTransactions = result.transactions.filter(
        (transaction) => !existingKeys.has(transaction.sourceKey),
      )
      setPreview({
        fileName: file.name,
        result,
        newTransactions,
        existingDuplicateCount:
          result.transactions.length - newTransactions.length,
      })
      setIsError(false)
      setMessage(null)
    } catch (error) {
      setIsError(true)
      setMessage(
        error instanceof Error
          ? `Import failed: ${error.message}`
          : 'This file is not a valid Revolut CSV export.',
      )
    }
  }

  const confirmImport = () => {
    if (!preview || preview.newTransactions.length === 0) return
    const added = importTransactions(preview.newTransactions)
    const batchId = preview.newTransactions[0]!.importBatchId
    const latestMonth = [...preview.newTransactions]
      .map((transaction) => transaction.bookingDate.slice(0, 7))
      .sort()
      .at(-1)!

    setPreview(null)
    setLastImport({ batchId, count: added })
    setIsError(false)
    setMessage(
      `${added} ${plural(added, 'transaction')} imported.`,
    )
    onImported(latestMonth)
  }

  const undoLastImport = () => {
    if (!lastImport) return
    const deleted = deleteTransactionBatch(lastImport.batchId)
    setLastImport(null)
    setIsError(false)
    setMessage(
      `${deleted} ${plural(deleted, 'transaction')} deleted.`,
    )
  }

  return (
    <Section
      title="Add a Revolut statement"
      description="The file is analysed only in this browser. Only completed transactions are offered, and duplicates are ignored."
      contentClassName="space-y-4"
    >
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".csv,text/csv,text/plain"
        aria-label="Revolut CSV file"
        tabIndex={-1}
        onChange={(event) => void selectFile(event)}
      />
      <Button
        type="button"
        className="h-11 w-full sm:w-auto md:h-9"
        onClick={() => inputRef.current?.click()}
      >
        <FileUp aria-hidden="true" />
        Choose a CSV
      </Button>

      {message && (
        <Notice
          tone={isError ? 'error' : 'success'}
          role={isError ? 'alert' : 'status'}
          action={
            lastImport &&
            !isError && (
              <Button
                type="button"
                variant="ghost"
                className="h-11 md:h-9"
                onClick={undoLastImport}
              >
                <RotateCcw aria-hidden="true" />
                Undo this import
              </Button>
            )
          }
        >
          {message}
        </Notice>
      )}

      {preview && (
        <div className="space-y-4 rounded-lg border bg-muted/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium break-words">{preview.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {preview.result.rowCount} rows read
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-11 shrink-0 md:h-9"
              onClick={() => setPreview(null)}
            >
              <X aria-hidden="true" />
              Close
            </Button>
          </div>

          <div
            role="group"
            aria-label="Import summary"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {[
              ['New', preview.newTransactions.length],
              [
                'Duplicates',
                preview.existingDuplicateCount + issueCounts.duplicate,
              ],
              ['Pending', issueCounts.pending],
              ['Excluded', issueCounts.invalid + issueCounts.rejected],
            ].map(([label, count]) => (
              <div
                key={label}
                className="rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10"
              >
                <strong className="block text-lg font-semibold tabular-nums">
                  {count}
                </strong>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>

          {preview.newTransactions.length > 0 && (
            <div>
              <ul
                aria-label="Transactions to import"
                className="divide-y rounded-lg bg-card ring-1 ring-foreground/10"
              >
                {preview.newTransactions
                  .slice(0, PREVIEW_ROW_LIMIT)
                  .map((transaction) => (
                    <li
                      key={transaction.sourceKey}
                      className="flex items-start justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium break-words">
                          {transaction.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {transaction.bookingDate} ·{' '}
                          {kindLabels[transaction.kind]}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatTransactionAmount(
                          transaction.amountCents,
                          transaction.currency,
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
              {preview.newTransactions.length > PREVIEW_ROW_LIMIT && (
                <p className="mt-2 text-xs text-muted-foreground">
                  + {preview.newTransactions.length - PREVIEW_ROW_LIMIT} more
                  transactions
                </p>
              )}
            </div>
          )}

          {preview.result.issues.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                Show the {preview.result.issues.length} rows that cannot be
                imported
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {preview.result.issues.slice(0, ISSUE_LIMIT).map((issue, index) => (
                  <li key={`${issue.line}-${issue.reason}-${index}`}>
                    Row {issue.line}: {issue.message}
                  </li>
                ))}
              </ul>
              {preview.result.issues.length > ISSUE_LIMIT && (
                <p className="mt-2 text-muted-foreground">
                  {preview.result.issues.length - ISSUE_LIMIT} more rows are
                  not shown.
                </p>
              )}
            </details>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => setPreview(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-11 md:h-9"
              disabled={preview.newTransactions.length === 0}
              onClick={confirmImport}
            >
              Import {preview.newTransactions.length}{' '}
              {plural(preview.newTransactions.length, 'transaction')}
            </Button>
          </div>
        </div>
      )}
    </Section>
  )
}
