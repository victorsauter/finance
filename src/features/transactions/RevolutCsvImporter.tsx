import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { FileUp, RotateCcw, X } from 'lucide-react'
import { useBudget } from '../../app/budget-context'
import type { ImportedTransaction } from '../../domain/budget/models'
import { formatTransactionAmount } from '../../domain/transactions/format'
import {
  parseRevolutCsv,
  type RevolutCsvIssueReason,
  type RevolutCsvResult,
} from '../../domain/transactions/revolut-csv'

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
    <section className="import-card" aria-labelledby="revolut-import-title">
      <div className="import-heading">
        <div>
          <p className="eyebrow">Local import</p>
          <h2 id="revolut-import-title">Add a Revolut statement</h2>
          <p>
            The file is analysed only in this browser. Only completed
            transactions are offered, and duplicates are ignored.
          </p>
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".csv,text/csv,text/plain"
          aria-label="Revolut CSV file"
          onChange={(event) => void selectFile(event)}
        />
        <button
          type="button"
          className="primary-button"
          onClick={() => inputRef.current?.click()}
        >
          <FileUp aria-hidden="true" size={17} />
          Choose a CSV
        </button>
      </div>

      {message && (
        <div
          className={`notice ${
            isError ? 'notice-error' : 'notice-success'
          } import-notice`}
          role={isError ? 'alert' : 'status'}
        >
          <span>{message}</span>
          {lastImport && !isError && (
            <button
              type="button"
              className="text-button"
              onClick={undoLastImport}
            >
              <RotateCcw aria-hidden="true" size={15} />
              Undo this import
            </button>
          )}
        </div>
      )}

      {preview && (
        <div className="import-preview">
          <div className="import-preview-heading">
            <div>
              <strong>{preview.fileName}</strong>
              <span>{preview.result.rowCount} rows read</span>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => setPreview(null)}
            >
              <X aria-hidden="true" size={15} />
              Close
            </button>
          </div>

          <div className="import-stats" aria-label="Import summary">
            <div>
              <strong>{preview.newTransactions.length}</strong>
              <span>New</span>
            </div>
            <div>
              <strong>
                {preview.existingDuplicateCount + issueCounts.duplicate}
              </strong>
              <span>Duplicates</span>
            </div>
            <div>
              <strong>{issueCounts.pending}</strong>
              <span>Pending</span>
            </div>
            <div>
              <strong>{issueCounts.invalid + issueCounts.rejected}</strong>
              <span>Excluded</span>
            </div>
          </div>

          {preview.newTransactions.length > 0 && (
            <div className="table-scroll import-table">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Detected type</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.newTransactions
                    .slice(0, 8)
                    .map((transaction) => (
                      <tr key={transaction.sourceKey}>
                        <td data-label="Date">{transaction.bookingDate}</td>
                        <td data-label="Description">{transaction.description}</td>
                        <td data-label="Type">
                          {
                            {
                              expense: 'Expense',
                              income: 'Income',
                              transfer: 'Transfer',
                            }[transaction.kind]
                          }
                        </td>
                        <td data-label="Amount">
                          {formatTransactionAmount(
                            transaction.amountCents,
                            transaction.currency,
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {preview.newTransactions.length > 8 && (
                <p className="import-more">
                  + {preview.newTransactions.length - 8} more transactions
                </p>
              )}
            </div>
          )}

          {preview.result.issues.length > 0 && (
            <details className="import-issues">
              <summary>
                Show the {preview.result.issues.length} rows that cannot be imported
              </summary>
              <ul>
                {preview.result.issues.slice(0, 20).map((issue, index) => (
                  <li key={`${issue.line}-${issue.reason}-${index}`}>
                    Row {issue.line}: {issue.message}
                  </li>
                ))}
              </ul>
              {preview.result.issues.length > 20 && (
                <p>
                  {preview.result.issues.length - 20} more rows are not shown.
                </p>
              )}
            </details>
          )}

          <div className="import-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={preview.newTransactions.length === 0}
              onClick={confirmImport}
            >
              Import {preview.newTransactions.length}{' '}
              {plural(preview.newTransactions.length, 'transaction')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
