import type { BudgetRepository } from './BudgetRepository'
import type { AppData } from '../domain/budget/models'

export class LocalBudgetStore {
  private saveQueue: Promise<void> = Promise.resolve()
  private readonly repository: BudgetRepository

  constructor(repository: BudgetRepository) {
    this.repository = repository
  }

  load(): Promise<AppData | null> {
    return this.repository.load()
  }

  save(data: AppData): Promise<void> {
    const snapshot = structuredClone(data)
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(() => this.repository.save(snapshot))
    return this.saveQueue
  }

  replace(data: AppData): Promise<void> {
    return this.save(data)
  }

  clear(): Promise<void> {
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(() => this.repository.clear())
    return this.saveQueue
  }

  close(): void {
    this.repository.close()
  }
}
