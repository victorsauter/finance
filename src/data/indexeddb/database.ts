import Dexie, { type EntityTable } from 'dexie'
import type { AppData } from '../../domain/budget/models'

export interface AppStateRecord {
  id: 'primary'
  data: AppData
}

export const FINANCE_DATABASE_NAME = 'finance'
export const LEGACY_DATABASE_NAME = 'mon-budget'

export class BudgetDatabase extends Dexie {
  appState!: EntityTable<AppStateRecord, 'id'>

  constructor(name = FINANCE_DATABASE_NAME) {
    super(name)
    this.version(1).stores({
      appState: '&id',
    })
  }
}
