import { useRef, useState, type ChangeEvent } from 'react'
import { Download, FileUp, ShieldCheck, Trash2 } from 'lucide-react'
import { useBudget } from '../../app/budget-context'
import { CURRENT_SCHEMA_VERSION } from '../../domain/budget/models'
import { parseAppData } from '../../domain/budget/schema'
import { downloadJson } from './download'
import { useSync } from '../../app/sync-context'

export function BackupPage() {
  const { data, replaceData, resetData } = useBudget()
  const { state: sync } = useSync()
  const cloudEnabled = sync.status !== 'disabled'
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
          `Replace current data with ${budgetCount} budget(s) and ${transactionCount} transaction(s) from “${file.name}”?${cloudEnabled ? ' This replacement will sync to your other devices. A backup of the current data will be downloaded first.' : ''}`,
        )
      ) {
        return
      }
      if (cloudEnabled) downloadJson('finance-before-restore.json', data)
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
        cloudEnabled
          ? 'Reset all budgets and transactions in this account to an empty month? This reset will sync to your other devices. A backup will be downloaded first.'
          : 'Delete all local budgets and create an empty month? Export a backup before continuing.',
      )
    ) {
      return
    }
    if (cloudEnabled) downloadJson('finance-before-reset.json', data)
    await resetData()
    setIsError(false)
    setMessage(cloudEnabled ? 'Account data has been reset locally. Check the sync status before closing this device.' : 'Local data has been reset.')
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
          Keep a JSON backup regularly. {cloudEnabled
            ? 'Cloud sync copies changes between your devices; it is not a historical backup. Restores and resets here affect your synced account.'
            : 'These budgets are stored in this browser. On iPhone, the system can clear unused site storage.'}
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
            All budgets and imported transactions {cloudEnabled ? 'in this synced account' : 'on this device'} will be
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
