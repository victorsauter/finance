import Dexie, { type EntityTable } from 'dexie'
import type { AppData } from '../../domain/budget/models'

export interface AppStateRecord {
  id: 'primary'
  data: AppData
}

export class BudgetDatabase extends Dexie {
  appState!: EntityTable<AppStateRecord, 'id'>

  constructor(name = 'mon-budget') {
    super(name)
    this.version(1).stores({
      appState: '&id',
    })
  }
}
