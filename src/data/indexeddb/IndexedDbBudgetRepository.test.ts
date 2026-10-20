import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createInitialAppData } from '../../domain/budget/factory'
import { BudgetDatabase } from './database'
import { IndexedDbBudgetRepository } from './IndexedDbBudgetRepository'

const databases: BudgetDatabase[] = []

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()))
  databases.length = 0
})

describe('IndexedDbBudgetRepository', () => {
  it('persists and reloads application data', async () => {
    const database = new BudgetDatabase(`test-${crypto.randomUUID()}`)
    databases.push(database)
    const repository = new IndexedDbBudgetRepository(database)
    const data = createInitialAppData(new Date(2026, 8, 1))

    await repository.save(data)

    expect(await repository.load()).toEqual(data)
  })

  it('clears persisted data', async () => {
    const database = new BudgetDatabase(`test-${crypto.randomUUID()}`)
    databases.push(database)
    const repository = new IndexedDbBudgetRepository(database)
    await repository.save(createInitialAppData())

    await repository.clear()

    expect(await repository.load()).toBeNull()
  })
})
