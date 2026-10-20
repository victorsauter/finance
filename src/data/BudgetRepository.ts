import type { AppData } from '../domain/budget/models'

export interface BudgetRepository {
  load(): Promise<AppData | null>
  save(data: AppData): Promise<void>
  clear(): Promise<void>
  close(): void
}
