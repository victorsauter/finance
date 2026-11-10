import { liveQuery } from 'dexie'
import type { BudgetRepository } from '../BudgetRepository'
import { BudgetDatabase, type AppStateRecord } from '../indexeddb/database'
import { parseAppData } from '../../domain/budget/schema'
import type { AppData } from '../../domain/budget/models'
import type { CloudSnapshot, CloudTransport, SyncState, SyncMetadata } from './types'

const metadata = (): SyncMetadata => ({ enabled: false, revision: 0, sequence: 0 })

// One durable pending snapshot is an outbox. Its mutation ID is retained until
// acknowledged, including when the response is lost or newer local edits exist.
export class CloudBudgetRepository implements BudgetRepository {
  readonly database: BudgetDatabase
  private transport: CloudTransport
  private writer = crypto.randomUUID()
  private stopped = false
  private active: Promise<void> | null = null
  private state: SyncState = { status: 'disabled' }
  private listeners = new Set<() => void>()
  private dataListeners = new Set<(data: AppData) => void>()
  private unsubscribe?: () => void
  private lastData = ''
  private localGeneration = 0

  // Called synchronously before LocalBudgetStore queues an edit. A remote read
  // must not replace UI edits that have not reached IndexedDB yet.
  markLocalEdit() { this.localGeneration += 1 }

  constructor(database: BudgetDatabase, transport: CloudTransport) {
    this.database = database
    this.transport = transport
  }

  getSnapshot = () => this.state
  subscribe = (callback: () => void) => {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }

  private notify(state: SyncState) {
    if (this.stopped) return
    this.state = state
    this.listeners.forEach((callback) => callback())
  }

  watch(callback: (data: AppData) => void) {
    this.stopped = false
    this.dataListeners.add(callback)
    if (!this.unsubscribe) {
      const subscription = liveQuery(() => this.database.appState.get('primary')).subscribe({
        next: (record) => {
          if (!record || this.stopped) return
          const remoteWriter = `remote:${this.writer}:`
          if (record.writer?.startsWith(remoteWriter)
            && record.writer !== `${remoteWriter}${this.localGeneration}`) return
          const json = JSON.stringify(record.data)
          if (json !== this.lastData && record.writer !== this.writer) {
            this.lastData = json
            this.dataListeners.forEach((listener) => listener(parseAppData(record.data)))
          }
          if (record.sync?.conflict) this.notify({ status: 'conflict' })
        },
        error: () => this.notify({ status: 'error', error: 'Unable to read the local sync queue.' }),
      })
      this.unsubscribe = () => subscription.unsubscribe()
    }
    return () => {
      this.dataListeners.delete(callback)
      if (!this.dataListeners.size) {
        this.unsubscribe?.()
        this.unsubscribe = undefined
        this.stopped = true
      }
    }
  }

  async load() {
    const record = await this.database.appState.get('primary')
    if (record) this.notify({ status: record.sync?.conflict ? 'conflict' : record.sync?.enabled ? 'idle' : 'disabled' })
    return record ? parseAppData(record.data) : null
  }

  async save(data: AppData) {
    this.localGeneration += 1
    const validated = parseAppData(data)
    await this.database.transaction('rw', this.database.appState, async () => {
      const previous = await this.database.appState.get('primary')
      const sync = previous?.sync ?? metadata()
      const sequence = sync.sequence + 1
      await this.database.appState.put({
        id: 'primary', data: validated, writer: this.writer,
        sync: {
          ...sync, sequence,
          pending: sync.enabled ? (sync.pending ?? {
            id: crypto.randomUUID(), data: validated, sequence, revision: sync.revision,
          }) : undefined,
        },
      })
    })
    if (!this.stopped) void this.sync()
  }

  async clear() {
    throw new Error('Cloud data cannot be deleted by clearing a local cache. Use an explicit reset.')
  }

  close() {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    // Keep queued writes durable. Do not close Dexie during StrictMode replay.
  }

  async inspectRemote() { return this.transport.read() }

  async enable(localData?: AppData) {
    const generation = this.localGeneration
    const before = await this.database.appState.get('primary')
    const remote = await this.transport.read()
    if (this.stopped) throw new Error('The account has changed. Please try again.')
    await this.database.transaction('rw', this.database.appState, async () => {
      const current = await this.database.appState.get('primary')
      if (!current) throw new Error('The local budget is not ready.')
      if (generation !== this.localGeneration || current.sync?.sequence !== before?.sync?.sequence) {
        throw new Error('Local budgets changed while checking the cloud. Please review and try again.')
      }
      if (remote && localData) throw new Error('This account already has cloud data. Download it first, then import a backup explicitly.')
      if (remote) {
        await this.database.appState.put({ id: 'primary', data: remote.data, writer: `remote:${this.writer}:${generation}`,
          sync: { ...metadata(), enabled: true, revision: remote.revision } })
      } else {
        const data = parseAppData(localData ?? current.data)
        await this.database.appState.put({ id: 'primary', data, writer: `remote:${this.writer}:${generation}`,
          sync: { enabled: true, revision: 0, sequence: 1,
            pending: { id: crypto.randomUUID(), data, sequence: 1, revision: 0 } } })
      }
    })
    await this.sync()
  }

  async useRemote() {
    const generation = this.localGeneration
    const before = await this.database.appState.get('primary')
    const remote = await this.transport.read()
    if (!remote) throw new Error('The cloud copy is unavailable. Your local data has been kept.')
    if (this.stopped) return
    await this.database.transaction('rw', this.database.appState, async () => {
      const latest = await this.database.appState.get('primary')
      if (generation !== this.localGeneration || latest?.sync?.sequence !== before?.sync?.sequence) {
        throw new Error('Local edits changed while downloading. Export the latest local copy and try again.')
      }
      await this.database.appState.put({ id: 'primary', data: remote.data, writer: `remote:${this.writer}:${generation}`,
        sync: { enabled: true, revision: remote.revision, sequence: 0 } })
    })
    this.notify({ status: 'synced' })
  }

  async keepLocal() {
    if (this.stopped) return
    // Only overwrite the version the user reviewed. A newer remote write will
    // conflict again rather than being silently discarded.
    await this.database.transaction('rw', this.database.appState, async () => {
      const record = await this.database.appState.get('primary')
      if (!record?.sync?.conflict) return
      const sync = record.sync
      const revision = sync.conflict!.revision
      await this.database.appState.put({ ...record,
        sync: { ...sync, revision, conflict: undefined,
          pending: { id: crypto.randomUUID(), data: record.data, sequence: sync.sequence, revision } } })
    })
    await this.sync()
  }

  sync = (): Promise<void> => {
    if (this.active) return this.active
    this.active = this.performSync().catch((error: unknown) => {
      this.notify({ status: 'error', error: error instanceof Error ? error.message : 'Cloud sync failed. Local changes are safe.' })
    }).finally(() => { this.active = null })
    return this.active
  }

  private async rememberConflict(record: AppStateRecord, remote: CloudSnapshot) {
    await this.database.transaction('rw', this.database.appState, async () => {
      const latest = await this.database.appState.get('primary')
      if (latest?.sync && latest.sync.revision === record.sync?.revision) {
        await this.database.appState.put({ ...latest, sync: { ...latest.sync, conflict: remote } })
      }
    })
    this.notify({ status: 'conflict' })
  }

  private async performSync() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (this.stopped) return
      const record = await this.database.appState.get('primary')
      if (!record?.sync?.enabled) { this.notify({ status: 'disabled' }); return }
      if (record.sync.conflict) { this.notify({ status: 'conflict' }); return }
      if (typeof navigator !== 'undefined' && !navigator.onLine) { this.notify({ status: 'pending' }); return }
      this.notify({ status: 'syncing' })
      const pending = record.sync.pending
      if (pending) {
        const result = await this.transport.write(pending.data, pending.revision, pending.id)
        if (this.stopped) return
        if (result.status === 'conflict') {
          const remote = await this.transport.read()
          if (this.stopped) return
          if (!remote) throw new Error('The cloud copy is unavailable.')
          await this.rememberConflict(record, remote)
          return
        }
        await this.database.transaction('rw', this.database.appState, async () => {
          const latest = await this.database.appState.get('primary')
          if (!latest?.sync?.pending || latest.sync.pending.id !== pending.id) return
          const sync: NonNullable<AppStateRecord['sync']> = { ...latest.sync, revision: result.revision, pending: undefined }
          if (latest.sync.sequence !== pending.sequence) {
            sync.pending = { id: crypto.randomUUID(), data: latest.data,
              sequence: latest.sync.sequence, revision: result.revision }
          }
          await this.database.appState.put({ ...latest, sync })
        })
        continue
      }
      const generation = this.localGeneration
      const remote = await this.transport.read()
      if (this.stopped) return
      if (!remote) throw new Error('The cloud copy is unavailable. Local data has been kept.')
      await this.database.transaction('rw', this.database.appState, async () => {
        const latest = await this.database.appState.get('primary')
        if (generation !== this.localGeneration || latest?.sync?.pending || latest?.sync?.sequence !== record.sync!.sequence) return
        if (remote.revision !== record.sync!.revision) {
          await this.database.appState.put({ id: 'primary', data: remote.data, writer: `remote:${this.writer}:${generation}`,
            sync: { ...latest!.sync!, revision: remote.revision } })
        }
      })
      const latest = await this.database.appState.get('primary')
      if (latest?.sync?.pending) continue
      this.notify({ status: 'synced' })
      return
    }
    this.notify({ status: 'pending' })
  }
}
