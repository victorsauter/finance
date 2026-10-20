import { useRef, useState, type ChangeEvent } from 'react'
import { Download, FileUp, ShieldCheck, Trash2 } from 'lucide-react'
import { useBudget } from '../../app/budget-context'
import { CURRENT_SCHEMA_VERSION } from '../../domain/budget/models'
import { parseAppData } from '../../domain/budget/schema'

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function BackupPage() {
  const { data, replaceData, resetData } = useBudget()
  const inputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const exportBackup = () => {
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(`finance-${date}.json`, data)
    setIsError(false)
    setMessage('The JSON backup has been downloaded.')
  }

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const parsed = parseAppData(JSON.parse(await file.text()))
      const budgetCount = parsed.budgetMonths.length
      const transactionCount = parsed.importedTransactions.length
      if (
        !window.confirm(
          `Replace current data with ${budgetCount} budget(s) and ${transactionCount} transaction(s) from “${file.name}”?`,
        )
      ) {
        return
      }
      await replaceData(parsed)
      setIsError(false)
      setMessage(
        `${budgetCount} budget(s) and ${transactionCount} transaction(s) have been restored.`,
      )
    } catch (importError) {
      setIsError(true)
      setMessage(
        importError instanceof Error
          ? `Invalid backup: ${importError.message}`
          : 'This file does not contain a valid backup.',
      )
    }
  }

  const reset = async () => {
    if (
      !window.confirm(
        'Delete all local budgets and create an empty month? Export a backup before continuing.',
      )
    ) {
      return
    }
    await resetData()
    setIsError(false)
    setMessage('Local data has been reset.')
  }

  return (
    <main className="content-page narrow-page">
      <div className="page-intro">
          <p className="eyebrow">Local data</p>
        <div className="page-title-with-icon">
          <span aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <h1>Backup and restore</h1>
        </div>
        <p>
          Your budget stays in this browser. Keep a JSON backup regularly,
          especially on iPhone, where the system can clear unused site storage.
        </p>
      </div>

      {message && (
        <div
          className={`notice ${isError ? 'notice-error' : 'notice-success'}`}
          role={isError ? 'alert' : 'status'}
        >
          {message}
        </div>
      )}

      <div className="settings-group">
      <section className="settings-card">
        <span className="settings-icon is-primary" aria-hidden="true">
          <Download size={20} />
        </span>
        <div className="settings-copy">
          <p className="eyebrow">Export</p>
          <h2>Download a copy</h2>
          <p>
            This backup contains {data.budgetMonths.length} budget(s) and{' '}
            {data.importedTransactions.length} transaction(s), using data
            format version {CURRENT_SCHEMA_VERSION}.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={exportBackup}>
          <Download aria-hidden="true" size={17} />
          Download JSON
        </button>
      </section>

      <section className="settings-card">
        <span className="settings-icon is-secondary" aria-hidden="true">
          <FileUp size={20} />
        </span>
        <div className="settings-copy">
          <p className="eyebrow">Restore</p>
          <h2>Import a backup</h2>
          <p>
            The file is fully validated before it replaces local data.
          </p>
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void importBackup(event)}
        />
        <button
          type="button"
          className="secondary-button"
          onClick={() => inputRef.current?.click()}
        >
          <FileUp aria-hidden="true" size={17} />
          Choose a file
        </button>
      </section>
      </div>

      <section className="settings-card danger-zone">
        <span className="settings-icon is-danger" aria-hidden="true">
          <Trash2 size={20} />
        </span>
        <div className="settings-copy">
          <p className="eyebrow">Danger zone</p>
          <h2>Reset the app</h2>
          <p>
            All budgets and imported transactions on this device will be
            replaced with an empty month.
          </p>
        </div>
        <button type="button" className="danger-button" onClick={() => void reset()}>
          <Trash2 aria-hidden="true" size={17} />
          Reset everything
        </button>
      </section>
    </main>
  )
}
