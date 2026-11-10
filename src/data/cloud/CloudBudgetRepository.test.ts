import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetDatabase } from '../indexeddb/database'
import { createInitialAppData } from '../../domain/budget/factory'
import type { AppData } from '../../domain/budget/models'
import { CloudBudgetRepository } from './CloudBudgetRepository'
import type { CloudTransport, CloudSnapshot, CloudWrite } from './types'

class Server implements CloudTransport {
  current: CloudSnapshot | null = null
  receipts = new Map<string, number>()
  writes: string[] = []
  loseResponse = false
  async read() { return structuredClone(this.current) }
  async write(data: AppData, revision: number, id: string): Promise<CloudWrite> {
    this.writes.push(id)
    const receipt = this.receipts.get(id)
    if (receipt) return { status: 'saved', revision: receipt }
    if ((this.current?.revision ?? 0) !== revision) return { status: 'conflict', revision: this.current!.revision }
    this.current = { data: structuredClone(data), revision: revision + 1 }
    this.receipts.set(id, revision + 1)
    if (this.loseResponse) { this.loseResponse = false; throw new Error('Connection lost after server commit') }
    return { status: 'saved', revision: revision + 1 }
  }
}

const repositories: CloudBudgetRepository[] = []
function device(server: CloudTransport) {
  const repo = new CloudBudgetRepository(new BudgetDatabase(`sync-test-${crypto.randomUUID()}`), server)
  repositories.push(repo)
  return repo
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(repositories.map(async (repo) => { await repo.sync(); repo.close(); await repo.database.delete() }))
  repositories.length = 0
})

describe('private offline cloud repository', () => {
  it('does not upload local data until sync has been explicitly enabled', async () => {
    const server = new Server()
    const repo = device(server)
    const data = createInitialAppData()
    await repo.save(data)
    await repo.sync()
    expect(server.current).toBeNull()
    expect(await repo.load()).toEqual(data)
    await repo.enable(data)
    expect(server.current?.data).toEqual(data)
    expect(repo.getSnapshot().status).toBe('synced')
  })

  it('downloads an existing account without replacing it with guest data', async () => {
    const server = new Server()
    server.current = { data: createInitialAppData(), revision: 4 }
    const repo = device(server)
    const guest = createInitialAppData()
    await repo.save(guest)
    await expect(repo.enable(guest)).rejects.toThrow('already has cloud data')
    await repo.enable()
    expect(await repo.load()).toEqual(server.current.data)
    expect(server.writes).toHaveLength(0)
  })

  it('keeps edits durable offline and uploads them after reconnect', async () => {
    const server = new Server()
    const repo = device(server)
    const data = createInitialAppData()
    await repo.save(data)
    await repo.enable()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    data.budgetMonths[0]!.name = 'Offline edit'
    await repo.save(data)
    await repo.sync()
    expect(repo.getSnapshot().status).toBe('pending')
    const cached = await repo.database.appState.get('primary')
    expect(cached?.sync?.pending).toBeDefined()
    expect(server.current?.data.budgetMonths[0]!.name).not.toBe('Offline edit')
    online.mockReturnValue(true)
    await repo.sync()
    expect(server.current?.data.budgetMonths[0]!.name).toBe('Offline edit')
    expect((await repo.database.appState.get('primary'))?.sync?.pending).toBeUndefined()
  })

  it('retries an acknowledged server write using the same ID after losing the response', async () => {
    const server = new Server()
    const repo = device(server)
    const data = createInitialAppData()
    await repo.save(data)
    server.loseResponse = true
    await repo.enable()
    expect(repo.getSnapshot().status).toBe('error')
    const id = (await repo.database.appState.get('primary'))!.sync!.pending!.id
    await repo.sync()
    expect(server.current?.revision).toBe(1)
    expect(server.writes).toEqual([id, id])
    expect(repo.getSnapshot().status).toBe('synced')
  })

  it('stops on a two-device conflict and preserves both versions until explicit resolution', async () => {
    const server = new Server()
    const first = device(server)
    const second = device(server)
    const original = createInitialAppData()
    await first.save(original); await first.enable()
    await second.save(original); await second.enable()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const local = structuredClone(original)
    local.budgetMonths[0]!.name = 'Second device'
    await second.save(local); await second.sync()
    const remote = structuredClone(original)
    remote.budgetMonths[0]!.name = 'First device'
    await first.save(remote); await first.sync()
    online.mockReturnValue(true)
    await first.sync(); await second.sync()
    expect(second.getSnapshot().status).toBe('conflict')
    expect((await second.load())!.budgetMonths[0]!.name).toBe('Second device')
    expect(server.current!.data.budgetMonths[0]!.name).toBe('First device')
    await second.keepLocal()
    expect(server.current!.data.budgetMonths[0]!.name).toBe('Second device')
    await first.sync()
    expect((await first.load())!.budgetMonths[0]!.name).toBe('Second device')
  })

  it('preserves a newer edit made while an older snapshot is in flight', async () => {
    const server = new Server()
    const repo = device(server)
    const original = createInitialAppData()
    await repo.save(original); await repo.enable()
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const write = server.write.bind(server)
    let delay = true
    server.write = async (...args) => { if (delay) { delay = false; entered(); await gate } return write(...args) }
    const one = structuredClone(original); one.budgetMonths[0]!.name = 'First edit'
    await repo.save(one)
    await started
    const two = structuredClone(original); two.budgetMonths[0]!.name = 'Newer edit'
    await repo.save(two)
    release()
    await repo.sync()
    expect(server.current!.data.budgetMonths[0]!.name).toBe('Newer edit')
    expect(repo.getSnapshot().status).toBe('synced')
  })

  it('keeps account caches separate and pauses writes after disposal', async () => {
    const serverA = new Server(); const serverB = new Server()
    const first = device(serverA); const second = device(serverB)
    const data = createInitialAppData()
    await first.save(data); await first.enable()
    expect(await second.load()).toBeNull()
    const stop = first.watch(() => {})
    stop()
    const changed = structuredClone(data); changed.budgetMonths[0]!.name = 'Paused'
    await first.save(changed)
    await first.sync()
    expect(serverA.current!.data.budgetMonths[0]!.name).not.toBe('Paused')
    expect(serverB.current).toBeNull()
  })

  it('does not apply a remote refresh over an edit still in the local save queue', async () => {
    const server = new Server()
    const repo = device(server)
    const original = createInitialAppData()
    await repo.save(original); await repo.enable()
    const newer = structuredClone(original); newer.budgetMonths[0]!.name = 'Other device'
    server.current = { data: newer, revision: 2 }
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const read = server.read.bind(server)
    server.read = async () => { entered(); await gate; return read() }
    const refresh = repo.sync()
    await started
    repo.markLocalEdit()
    release()
    await refresh
    expect((await repo.load())!.budgetMonths[0]!.name).toBe(original.budgetMonths[0]!.name)
    server.read = read
  })

  it('refuses to discard new edits made while downloading a conflict resolution', async () => {
    const server = new Server()
    const repo = device(server)
    await repo.save(createInitialAppData()); await repo.enable()
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const read = server.read.bind(server)
    server.read = async () => { entered(); await gate; return read() }
    const replace = repo.useRemote()
    await started
    repo.markLocalEdit()
    const assertion = expect(replace).rejects.toThrow('Local edits changed')
    release()
    await assertion
    server.read = read
  })
})
