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
  /** The month being viewed. May be virtual (unsaved), see below. */
  activeBudget: BudgetMonth
  /** True while `activeBudget` is a seeded month that is not persisted yet. */
  activeBudgetIsVirtual: boolean
  /** Year of `activeBudget`, for the calendar year bar. */
  selectedYear: number
  /** Sorted `YYYY-MM` keys of the months that are actually persisted. */
  savedMonthKeys: string[]
  saveStatus: SaveStatus
  error: string | null
  /**
   * Shows a month. A month that does not exist is a virtual, seeded month that
   * is only saved by the first `updateActiveBudget` call.
   */
  openMonth: (year: number, month: number) => void
  /** Re-seeds the active month from the nearest earlier month (or empty). */
  resetActiveBudget: () => void
  setActiveBudget: (id: string) => void
  /** @deprecated Use `openMonth`. */
  goToAdjacentBudget: (direction: -1 | 1) => void
  /** @deprecated Use `openMonth`. */
  createFollowingBudget: (copyCurrent: boolean) => void
  /** @deprecated Use `resetActiveBudget`. */
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
    throw new Error('useBudget must be used within BudgetProvider.')
  }
  return context
}
