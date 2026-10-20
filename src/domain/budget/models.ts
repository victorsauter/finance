export const CURRENT_SCHEMA_VERSION = 2 as const

export type EntityId = string

export interface Income {
  id: EntityId
  name: string
  amountCents: number
  sortOrder: number
}

export interface Account {
  id: EntityId
  name: string
  plannedTransferCents: number
  sortOrder: number
}

export interface ExpenseItem {
  id: EntityId
  name: string
  amountCents: number
  sortOrder: number
}

export interface ExpenseCategory {
  id: EntityId
  name: string
  accountId: EntityId | null
  items: ExpenseItem[]
  sortOrder: number
}

export interface BudgetMonth {
  id: EntityId
  year: number
  month: number
  name: string
  incomes: Income[]
  accounts: Account[]
  expenseCategories: ExpenseCategory[]
  createdAt: string
  updatedAt: string
}

export type ImportedTransactionKind = 'expense' | 'income' | 'transfer'

export interface ImportedTransaction {
  id: EntityId
  provider: 'revolut-csv'
  sourceKey: string
  sourceReference: string | null
  importBatchId: EntityId
  sourceFileName: string
  bookingDate: string
  startedAt: string | null
  completedAt: string | null
  description: string
  amountCents: number
  feeCents: number
  balanceCents: number | null
  currency: string
  transactionType: string | null
  product: string | null
  kind: ImportedTransactionKind
  categoryId: EntityId | null
  importedAt: string
}

export interface AppSettings {
  activeBudgetMonthId: EntityId | null
}

export interface AppData {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION
  settings: AppSettings
  budgetMonths: BudgetMonth[]
  importedTransactions: ImportedTransaction[]
}
