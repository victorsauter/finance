/**
 * The one path every write takes:
 * read document + revision -> pure operation on a clone -> cap check ->
 * parseAppData -> dry run diff, or: local backup of the PRE-write document,
 * then save_finance_document with the read revision and a fresh mutation id.
 *
 * On a revision conflict nothing is retried; the backup taken just before
 * stays on disk (it is a copy of what was read, harmless and still useful).
 */
import { randomUUID } from 'node:crypto'
import type { AppData } from '../../../src/domain/budget/models.ts'
import { parseAppData } from '../../../src/domain/budget/schema.ts'
import { BackupStore, firstIssue } from './backup.ts'
import { MAX_CHANGES_PER_CALL } from './config.ts'
import { renderDiff } from './diff.ts'
import { ToolError } from './helpers.ts'
import type { OperationResult } from './operations.ts'
import type { DocumentStore } from './store.ts'

export interface WriteContext {
  store: DocumentStore
  backups: BackupStore
  newMutationId?: () => string
}

export interface WriteOutcome {
  dryRun: boolean
  saved: boolean
  readRevision: number
  revision?: number
  backup?: string
  changed: number
  diff: string
  notes?: string[]
  next?: string
}

export async function readDocument(store: DocumentStore) {
  const snapshot = await store.read()
  if (!snapshot) {
    throw new ToolError('There is no finance document in the cloud yet. Sign in once in the web or iPhone app to create it.')
  }
  return snapshot
}

export function conflictMessage(revision: number) {
  return `Data changed elsewhere (revision ${revision}). Re-read first (e.g. get_budget) and redo the change.`
}

async function commit(
  context: WriteContext,
  snapshot: { data: AppData; revision: number },
  next: AppData,
  reason: string,
) {
  let backup: string
  try {
    backup = await context.backups.save(snapshot.data, snapshot.revision, reason)
  } catch (error) {
    throw new ToolError(`Nothing written: the backup could not be saved in ${context.backups.directory} (${String(error)}).`)
  }
  const mutationId = (context.newMutationId ?? randomUUID)()
  const written = await context.store.write(next, snapshot.revision, mutationId)
  if (written.status === 'conflict') {
    throw new ToolError(`${conflictMessage(written.revision)} (Nothing was written; the local backup ${backup} of the version you read was kept.)`)
  }
  return { backup, revision: written.revision }
}

function validate(next: AppData): AppData {
  try {
    return parseAppData(next)
  } catch (error) {
    throw new ToolError(`Nothing changed: the result would not be a valid finance document (${firstIssue(error)}).`)
  }
}

export async function runWrite(
  context: WriteContext,
  options: { dryRun?: boolean; reason: string },
  apply: (data: AppData) => OperationResult,
): Promise<WriteOutcome> {
  const dryRun = options.dryRun ?? true
  const snapshot = await readDocument(context.store)
  const operation = apply(snapshot.data)
  if (operation.changedCount > MAX_CHANGES_PER_CALL) {
    throw new ToolError(
      `Nothing changed: this call would change ${operation.changedCount} transactions/items; the limit is ${MAX_CHANGES_PER_CALL} per call. Split it (narrow from/to or pass fewer ids).`,
    )
  }
  const notes = operation.notes.length > 0 ? operation.notes : undefined
  if (operation.changes.length === 0) {
    return { dryRun, saved: false, readRevision: snapshot.revision, changed: 0, diff: 'No change: everything already has these values.', notes }
  }
  const next = validate(operation.next)
  const diff = renderDiff(operation.lines)
  if (dryRun) {
    return {
      dryRun: true, saved: false, readRevision: snapshot.revision, changed: operation.changedCount, diff, notes,
      next: 'Dry run only. Show this to the owner; call again with dry_run: false to apply.',
    }
  }
  const { backup, revision } = await commit(context, snapshot, next, options.reason)
  return { dryRun: false, saved: true, readRevision: snapshot.revision, revision, backup, changed: operation.changedCount, diff, notes }
}

function counts(data: AppData) {
  return `${data.budgetMonths.length} budget month(s), ${data.importedTransactions.length} transaction(s), ${data.importedTransactions.filter((transaction) => transaction.categoryId).length} categorised`
}

/**
 * Replaces the whole document with a backup (the one deliberate whole-document
 * write; the per-call change cap does not apply). The current document is
 * backed up first.
 */
export async function restoreBackup(
  context: WriteContext,
  args: { file: string; dryRun?: boolean },
): Promise<WriteOutcome> {
  const dryRun = args.dryRun ?? true
  const backup = await context.backups.read(args.file)
  const snapshot = await readDocument(context.store)
  const diff = renderDiff([
    `Backup ${args.file}: saved ${backup.savedAt} from revision ${backup.revision}${backup.reason ? ` before "${backup.reason}"` : ''}.`,
    `Current (revision ${snapshot.revision}): ${counts(snapshot.data)}`,
    `After restore: ${counts(backup.data)}`,
  ])
  if (dryRun) {
    return {
      dryRun: true, saved: false, readRevision: snapshot.revision, changed: 1, diff,
      next: 'Dry run only. Restoring replaces the whole cloud document; call again with dry_run: false to apply.',
    }
  }
  const next = validate(backup.data)
  const written = await commit(context, snapshot, next, `restore ${args.file}`)
  return { dryRun: false, saved: true, readRevision: snapshot.revision, revision: written.revision, backup: written.backup, changed: 1, diff }
}
