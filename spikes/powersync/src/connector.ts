// Backend connector: downloads authenticate with the signed-in user's Supabase
// access token; uploads go through PostgREST (supabase-js) AS THAT USER, so RLS,
// column grants, constraints and triggers apply to every write.
//
// Handling chosen for the spike (see README, scenario 4):
//   * transient errors (network, 5xx, PostgREST connection errors): throw, the
//     SDK retries the whole transaction after retryDelayMs. Re-applying is safe:
//     a PUT that already landed hits the primary key and is turned into an
//     update, a PATCH is idempotent.
//   * permanent errors (SQLSTATE 22xxx, 23xxx, 42501, 42703, PGRST204, an
//     update that matched no visible row, a detected conflict): record the op in
//     the local-only `upload_rejections` table, carry on with the rest of the
//     transaction, then complete() it so the queue never blocks. PowerSync then
//     reverts the rejected local change at the next checkpoint.
import {
  UpdateType,
  type AbstractPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from '@powersync/node'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { POWERSYNC_URL } from './env.ts'

/** Columns a client may never update (no column grant). */
const NOT_UPDATABLE = new Set(['id', 'owner_id', 'created_at', 'updated_at'])
const TABLES_WITHOUT_SOFT_DELETE = new Set(['user_settings'])
const BULK_CHUNK = 1000

export interface ConnectorOptions {
  /** 'lww': plain per-column update. 'detect': compare-and-set on the previous values. */
  conflictMode?: 'lww' | 'detect'
  /** 'insert' (default) or the upsert used by the official Supabase demo connector. */
  putMode?: 'insert' | 'upsert'
  /** Turn a local hard DELETE into a soft delete (deleted_at = now()). */
  translateDeletes?: boolean
  /** Group consecutive PUTs to one table into bulk inserts (one statement each). */
  bulkInsert?: boolean
}

export interface Rejection {
  table: string
  id: string
  op: string
  code: string
  message: string
}

export interface UploadLogEntry {
  transactionId: number | undefined
  ops: number
  requests: number
  rejections: Rejection[]
  transientError?: string
  ms: number
}

class PermanentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function isPermanent(error: PostgrestError): boolean {
  const code = error.code ?? ''
  return /^2[23]...$/.test(code) || code === '42501' || code === '42703' || code === 'PGRST204'
}

function fail(error: PostgrestError): never {
  if (isPermanent(error)) throw new PermanentError(error.code, error.message)
  // Anything else (fetch failed, 5xx, PGRST00x connection errors) is retried.
  throw new Error(`transient upload error ${error.code || '(no code)'}: ${error.message}`)
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  readonly log: UploadLogEntry[] = []
  private readonly options: Required<ConnectorOptions>

  constructor(
    readonly supabase: SupabaseClient,
    options: ConnectorOptions = {},
  ) {
    this.options = {
      conflictMode: 'lww',
      putMode: 'insert',
      translateDeletes: false,
      bulkInsert: true,
      ...options,
    }
  }

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data, error } = await this.supabase.auth.getSession()
    if (error) throw error
    if (!data.session) return null
    return { endpoint: POWERSYNC_URL, token: data.session.access_token }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction()
    if (!transaction) return
    const started = performance.now()
    const entry: UploadLogEntry = {
      transactionId: transaction.transactionId,
      ops: transaction.crud.length,
      requests: 0,
      rejections: [],
      ms: 0,
    }
    this.log.push(entry)
    try {
      for (const group of this.group(transaction.crud)) {
        if (group.length > 1) {
          entry.requests += 1
          const { error } = await this.supabase.from(group[0].table).insert(group.map(rowOf))
          if (!error) continue
          if (!isPermanent(error)) fail(error)
          // One bad row fails the whole statement: replay row by row to isolate it.
        }
        for (const op of group) {
          try {
            entry.requests += await this.applyOne(op)
          } catch (error) {
            if (!(error instanceof PermanentError)) throw error
            entry.rejections.push({ table: op.table, id: op.id, op: op.op, code: error.code, message: error.message })
          }
        }
      }
    } catch (error) {
      entry.transientError = error instanceof Error ? error.message : String(error)
      entry.ms = performance.now() - started
      throw error
    }
    if (entry.rejections.length > 0) {
      const now = new Date().toISOString()
      await database.writeTransaction(async (tx) => {
        for (const rejection of entry.rejections) {
          const op = transaction.crud.find((c) => c.id === rejection.id && c.table === rejection.table)
          await tx.execute(
            `insert into upload_rejections (id, table_name, row_id, op, op_data, code, message, rejected_at)
             values (uuid(), ?, ?, ?, ?, ?, ?, ?)`,
            [rejection.table, rejection.id, rejection.op, JSON.stringify(op?.opData ?? null), rejection.code, rejection.message, now],
          )
        }
      })
    }
    await transaction.complete()
    entry.ms = performance.now() - started
  }

  /** Splits a transaction into runs of PUTs to the same table (bulk) and single ops. */
  private group(crud: CrudEntry[]): CrudEntry[][] {
    const groups: CrudEntry[][] = []
    for (const op of crud) {
      const last = groups.at(-1)
      const bulkable = this.options.bulkInsert && this.options.putMode === 'insert' && op.op === UpdateType.PUT
      if (bulkable && last && last[0].op === UpdateType.PUT && last[0].table === op.table && last.length < BULK_CHUNK) {
        last.push(op)
      } else {
        groups.push([op])
      }
    }
    return groups
  }

  private async applyPut(op: CrudEntry): Promise<number> {
    const table = this.supabase.from(op.table)
    if (this.options.putMode === 'upsert') {
      const { error } = await table.upsert(rowOf(op))
      if (error) fail(error)
      return 1
    }
    const { error } = await table.insert(rowOf(op))
    if (!error) return 1
    // A PUT whose row already exists: a retried upload, or a local
    // INSERT OR REPLACE. If the row is ours, apply it as an update.
    if (error.code === '23505' && error.message.includes(`${op.table}_pkey`)) {
      const changes = updatableColumns(op.opData ?? {})
      const { data, error: updateError } = await this.supabase.from(op.table).update(changes).eq('id', op.id).select('id')
      if (updateError) fail(updateError)
      if (!data?.length) throw new PermanentError('ID_TAKEN', `id ${op.id} exists but is not visible to this user`)
      return 2
    }
    fail(error)
  }

  /** Applies one op; returns the number of HTTP requests made. Throws PermanentError or transient errors. */
  private async applyOne(op: CrudEntry): Promise<number> {
    const table = this.supabase.from(op.table)
    switch (op.op) {
      case UpdateType.PUT:
        return this.applyPut(op)
      case UpdateType.PATCH: {
        const changes = op.opData ?? {}
        let query = this.supabase.from(op.table).update(changes).eq('id', op.id)
        if (this.options.conflictMode === 'detect') {
          for (const [column, previous] of Object.entries(op.previousValues ?? {})) {
            if (!(column in changes)) continue
            query = previous === null ? query.is(column, null) : query.eq(column, previous)
          }
          if (!TABLES_WITHOUT_SOFT_DELETE.has(op.table) && !('deleted_at' in changes)) {
            query = query.is('deleted_at', null)
          }
        }
        const { data, error } = await query.select('id')
        if (error) fail(error)
        if (!data?.length) {
          if (this.options.conflictMode === 'detect') {
            const { data: visible } = await this.supabase.from(op.table).select('id').eq('id', op.id)
            if (visible?.length) {
              throw new PermanentError('CONFLICT', `row changed or deleted on the server since this client read it`)
            }
          }
          throw new PermanentError('NO_ROW', 'update matched no row visible to this user (RLS-hidden or missing)')
        }
        return 1
      }
      case UpdateType.DELETE: {
        if (this.options.translateDeletes && !TABLES_WITHOUT_SOFT_DELETE.has(op.table)) {
          const { error } = await table.update({ deleted_at: new Date().toISOString() }).eq('id', op.id)
          if (error) fail(error)
          return 1
        }
        const { data, error } = await table.delete().eq('id', op.id).select('id')
        if (error) fail(error)
        if (!data?.length) throw new PermanentError('NO_ROW', 'delete matched no row visible to this user')
        return 1
      }
    }
  }
}

function rowOf(op: CrudEntry): Record<string, unknown> {
  return { ...op.opData, id: op.id }
}

function updatableColumns(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([column]) => !NOT_UPDATABLE.has(column)))
}
