import { useRef, useState, type ChangeEvent } from 'react'
import { Download, FileUp, Trash2 } from 'lucide-react'
import { useBudget } from '@/app/budget-context'
import { useSync } from '@/app/sync-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Section } from '@/components/layout/Section'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { Notice } from '@/components/ui/notice'
import { StatList } from '@/components/ui/stat-list'
import { touchControl } from '@/components/ui/touch'
import { CURRENT_SCHEMA_VERSION } from '@/domain/budget/models'
import { parseAppData } from '@/domain/budget/schema'
import { describeBackupError } from './describe-backup-error'
import { downloadJson } from './download'

const MAX_BACKUP_BYTES = 20 * 1024 * 1024

export function BackupPage() {
  const { data, replaceData, resetData } = useBudget()
  const confirm = useConfirm()
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

    if (file.size > MAX_BACKUP_BYTES) {
      setIsError(true)
      setMessage('This file is larger than the 20 MB limit for a backup.')
      return
    }

    try {
      const parsed = parseAppData(JSON.parse(await file.text()))
      const budgetCount = parsed.budgetMonths.length
      const transactionCount = parsed.importedTransactions.length
      const confirmed = await confirm({
        title: 'Replace your current data?',
        message: `${budgetCount} budget(s) and ${transactionCount} transaction(s) from “${file.name}” will replace what is stored now.${cloudEnabled ? ' The replacement will sync to your other devices. A backup of the current data is downloaded first.' : ''}`,
        confirmLabel: 'Replace data',
        tone: 'danger',
      })
      if (!confirmed) return
      if (cloudEnabled) downloadJson('finance-before-restore.json', data)
      await replaceData(parsed)
      setIsError(false)
      setMessage(
        `${budgetCount} budget(s) and ${transactionCount} transaction(s) have been restored.`,
      )
    } catch (importError) {
      setIsError(true)
      setMessage(describeBackupError(importError))
    }
  }

  const reset = async () => {
    const confirmed = await confirm({
      title: 'Reset everything?',
      message: cloudEnabled
        ? 'All budgets and transactions in this account will be replaced by an empty month. The reset will sync to your other devices. A backup is downloaded first.'
        : 'All local budgets will be deleted and replaced by an empty month. Export a backup before continuing.',
      confirmLabel: 'Reset everything',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      if (cloudEnabled) downloadJson('finance-before-reset.json', data)
      await resetData()
      setIsError(false)
      setMessage(
        cloudEnabled
          ? 'Account data has been reset locally. Check the sync status before closing this device.'
          : 'Local data has been reset.',
      )
    } catch (resetError) {
      setIsError(true)
      setMessage(
        resetError instanceof Error
          ? `Reset failed: ${resetError.message}`
          : 'The reset failed. Your data has been kept.',
      )
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Backup and restore"
        description={`Keep a JSON backup regularly. ${
          cloudEnabled
            ? 'Cloud sync copies changes between your devices; it is not a historical backup. Restores and resets here affect your synced account.'
            : 'These budgets are stored in this browser. On iPhone, the system can clear unused site storage.'
        }`}
      />

      {message && (
        <Notice tone={isError ? 'error' : 'success'}>{message}</Notice>
      )}

      <Section
        title="Download a copy"
        description="Save everything in a single JSON file you can restore later."
        contentClassName="flex flex-col gap-4"
      >
        <StatList
          items={[
            { label: 'Budgets', value: data.budgetMonths.length },
            { label: 'Transactions', value: data.importedTransactions.length },
            { label: 'Data format version', value: CURRENT_SCHEMA_VERSION },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className={touchControl}
            onClick={exportBackup}
          >
            <Download aria-hidden="true" />
            Download JSON
          </Button>
        </div>
      </Section>

      <Section
        title="Import a backup"
        description="The file is fully validated before it replaces local data, and you confirm first."
        contentClassName="flex flex-wrap gap-2"
      >
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="application/json,.json"
          aria-label="Backup file"
          onChange={(event) => void importBackup(event)}
        />
        <Button
          type="button"
          variant="outline"
          className={touchControl}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp aria-hidden="true" />
          Choose a file
        </Button>
      </Section>

      <Section
        title="Reset the app"
        description={`All budgets and imported transactions ${
          cloudEnabled ? 'in this synced account' : 'on this device'
        } will be replaced with an empty month.`}
        className="ring-destructive/30"
        contentClassName="flex flex-wrap gap-2"
      >
        <Button
          type="button"
          variant="destructive"
          className={touchControl}
          onClick={() => void reset()}
        >
          <Trash2 aria-hidden="true" />
          Reset everything
        </Button>
      </Section>
    </>
  )
}
