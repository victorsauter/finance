import { createContext, useContext } from 'react'
import type {
  AppData,
  BudgetMonth,
  ImportedTransaction,
  ImportedTransactionKind,
} from '../domain/budget/models'

export type SaveStatus = 'loading' | 'saving' | 'saved' | 'error'

export interface BudgetContextValue {
  data: AppData
  activeBudget: BudgetMonth
  saveStatus: SaveStatus
  error: string | null
  setActiveBudget: (id: string) => void
  goToAdjacentBudget: (direction: -1 | 1) => void
  createFollowingBudget: (copyCurrent: boolean) => void
  deleteActiveBudget: () => boolean
  updateActiveBudget: (update: (budget: BudgetMonth) => void) => void
  importTransactions: (transactions: ImportedTransaction[]) => number
  setTransactionCategory: (
    transactionId: string,
    categoryId: string | null,
  ) => void
  setTransactionKind: (
    transactionId: string,
    kind: ImportedTransactionKind,
  ) => void
  deleteTransaction: (transactionId: string) => void
  deleteTransactionBatch: (batchId: string) => number
  replaceData: (data: AppData) => Promise<void>
  resetData: () => Promise<void>
  dismissError: () => void
}

export const BudgetContext = createContext<BudgetContextValue | null>(null)

export function useBudget() {
  const context = useContext(BudgetContext)
  if (!context) {
    throw new Error('useBudget doit être utilisé dans BudgetProvider.')
  }
  return context
}
