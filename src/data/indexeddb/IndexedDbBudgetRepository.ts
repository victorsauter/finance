import type { BudgetRepository } from '../BudgetRepository'
import type { AppData } from '../../domain/budget/models'
import { parseAppData } from '../../domain/budget/schema'
import { BudgetDatabase } from './database'

export class IndexedDbBudgetRepository implements BudgetRepository {
  private readonly database: BudgetDatabase

  constructor(database = new BudgetDatabase()) {
    this.database = database
  }

  async load(): Promise<AppData | null> {
    const record = await this.database.appState.get('primary')
    return record ? parseAppData(record.data) : null
  }

  async save(data: AppData): Promise<void> {
    const validated = parseAppData(data)
    await this.database.appState.put({ id: 'primary', data: validated })
  }

  async clear(): Promise<void> {
    await this.database.appState.delete('primary')
  }

  close(): void {
    this.database.close()
  }
}
