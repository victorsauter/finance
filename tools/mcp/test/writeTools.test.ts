// @vitest-environment node
import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupStore } from '../src/backup.ts'
import { MAX_CHANGES_PER_CALL } from '../src/config.ts'
import * as op from '../src/operations.ts'
import { restoreBackup, runWrite, type WriteContext } from '../src/writeTools.ts'
import { FEB_GROCERY_TX, FEB_SAVING, FakeDocumentStore, UUID, sampleData, temporaryDirectory, transaction } from './support.ts'

const TX = '00000000-0000-4000-8000-000000000202'

describe('runWrite', () => {
  let temp: Awaited<ReturnType<typeof temporaryDirectory>>
  let store: FakeDocumentStore
  let backups: BackupStore
  let context: WriteContext
  const setCategory = (data: Parameters<typeof op.setTransactionCategory>[0]) =>
    op.setTransactionCategory(data, [TX], FEB_SAVING)

  beforeEach(async () => {
    temp = await temporaryDirectory()
    store = new FakeDocumentStore()
    backups = new BackupStore(path.join(temp.directory, 'backups'))
    context = { store, backups }
  })
  afterEach(() => temp.cleanup())

  it('defaults to a dry run that returns the diff and writes nothing', async () => {
    const outcome = await runWrite(context, { reason: 'test' }, setCategory)
    expect(outcome).toMatchObject({ dryRun: true, saved: false, readRevision: 7, changed: 1 })
    expect(outcome.diff).toMatch(/\(uncategorised\) -> Saving goals/)
    expect(store.writes).toHaveLength(0)
    expect(await backups.list()).toEqual([])
  })

  it('writes once with the read revision and a uuid mutation id, after a backup of the pre-write document', async () => {
    const events: string[] = []
    store = new FakeDocumentStore(sampleData(), 7, events)
    const original = await backups.save.bind(backups)
    backups.save = async (...args) => {
      events.push('backup')
      return original(...args)
    }
    context = { store, backups }
    const before = structuredClone(store.data)
    const outcome = await runWrite(context, { dryRun: false, reason: 'test' }, setCategory)

    expect(events).toEqual(['backup', 'write'])
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0]!.revision).toBe(7)
    expect(store.writes[0]!.mutationId).toMatch(UUID)
    expect(outcome).toMatchObject({ saved: true, revision: 8 })
    expect(store.data!.importedTransactions.find((t) => t.id === TX)!.categoryId).toBe(FEB_SAVING)

    const directory = backups.directory
    const [file] = await readdir(directory)
    expect(file).toBe(outcome.backup)
    expect(file).toMatch(/-r7-/)
    const saved = JSON.parse(await readFile(path.join(directory, file!), 'utf8'))
    expect(saved.data).toEqual(before)
    expect((await stat(path.join(directory, file!))).mode & 0o777).toBe(0o600)
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
  })

  it('aborts the write when the backup cannot be saved', async () => {
    const blocked = path.join(temp.directory, 'file-not-folder')
    await writeFile(blocked, 'x')
    context = { store, backups: new BackupStore(blocked) }
    await expect(runWrite(context, { dryRun: false, reason: 'test' }, setCategory)).rejects.toThrow(/Nothing written: the backup could not be saved/)
    expect(store.writes).toHaveLength(0)
  })

  it('returns a clear conflict error without retrying; the pre-write backup stays', async () => {
    const realRead = store.read.bind(store)
    store.read = async () => {
      const snapshot = await realRead()
      store.bumpElsewhere()
      return snapshot
    }
    await expect(runWrite(context, { dryRun: false, reason: 'test' }, setCategory))
      .rejects.toThrow('Data changed elsewhere (revision 8). Re-read first (e.g. get_budget) and redo the change.')
    expect(store.writes).toHaveLength(1)
    expect(await backups.list()).toHaveLength(1)
  })

  it('is idempotent on the mutation id (fake RPC behaviour)', async () => {
    const data = store.data!
    expect(await store.write(data, 7, 'same')).toEqual({ status: 'saved', revision: 8 })
    expect(await store.write(data, 7, 'same')).toEqual({ status: 'saved', revision: 8 })
    expect(store.revision).toBe(8)
  })

  it('refuses more than the cap of changes per call', async () => {
    const data = sampleData()
    for (let index = 0; index <= MAX_CHANGES_PER_CALL; index += 1) {
      data.importedTransactions.push(transaction({ description: 'Example repeated shop' }))
    }
    store = new FakeDocumentStore(data)
    context = { store, backups }
    await expect(runWrite(context, { dryRun: true, reason: 'test' }, (doc) =>
      op.setKindByDescription(doc, [{ description: 'Example repeated shop', kind: 'transfer' }], { from: '2026-02', to: '2026-02' }),
    )).rejects.toThrow(/would change 201 .* limit is 200/)
  })

  it('rejects a result that parseAppData refuses', async () => {
    await expect(runWrite(context, { dryRun: false, reason: 'test' }, (doc) => {
      const next = structuredClone(doc)
      next.budgetMonths[0]!.incomes[0]!.amountCents = -5
      return { next, changes: [{ entity: 'item', id: 'x', label: 'x', field: 'x', before: '', after: '' }], lines: [], notes: [], changedCount: 1 }
    })).rejects.toThrow(/not be a valid finance document/)
    expect(store.writes).toHaveLength(0)
  })

  it('skips the write when nothing changes', async () => {
    const outcome = await runWrite(context, { dryRun: false, reason: 'test' }, (doc) =>
      op.setTransactionCategory(doc, [FEB_GROCERY_TX], '00000000-0000-4000-8000-000000000047'))
    expect(outcome).toMatchObject({ saved: false, changed: 0 })
    expect(store.writes).toHaveLength(0)
  })

  it('errors when there is no cloud document', async () => {
    context = { store: new FakeDocumentStore(null), backups }
    await expect(runWrite(context, { reason: 'test' }, setCategory)).rejects.toThrow(/no finance document/)
  })

  describe('restore_backup', () => {
    it('validates, dry-runs, then restores with the current revision after backing up the current document', async () => {
      const first = await runWrite(context, { dryRun: false, reason: 'test' }, setCategory)
      expect(store.revision).toBe(8)

      const preview = await restoreBackup(context, { file: first.backup! })
      expect(preview).toMatchObject({ dryRun: true, saved: false })
      expect(preview.diff).toMatch(/from revision 7/)
      expect(store.writes).toHaveLength(1)

      const restored = await restoreBackup(context, { file: first.backup!, dryRun: false })
      expect(restored).toMatchObject({ saved: true, revision: 9 })
      expect(store.writes[1]!.revision).toBe(8)
      expect(store.data!.importedTransactions.find((t) => t.id === TX)!.categoryId).toBeNull()
      expect(await backups.list()).toHaveLength(2)
    })

    it('rejects path traversal and anything but a backup file name', async () => {
      for (const file of ['../secret.json', '/etc/passwd', 'finance-x.json', `sub/${'finance-2026-11-18T10-20-30-123Z-r1-abcdef.json'}`]) {
        await expect(restoreBackup(context, { file })).rejects.toThrow(/bare file name/)
      }
      await expect(restoreBackup(context, { file: 'finance-2026-11-18T10-20-30-123Z-r1-abcdef.json' })).rejects.toThrow(/No backup named/)
    })

    it('rejects a backup whose document is invalid', async () => {
      const name = 'finance-2026-11-18T10-20-30-123Z-r1-abcdef.json'
      await backups.save(sampleData(), 1, 'seed')
      await writeFile(path.join(backups.directory, name), JSON.stringify({ revision: 1, data: { schemaVersion: 2 } }))
      await chmod(path.join(backups.directory, name), 0o600)
      await expect(restoreBackup(context, { file: name })).rejects.toThrow(/does not contain a valid finance document/)
    })
  })
})
