import { z } from 'zod'
import type { EntityId, ImportedTransaction } from '@/domain/budget/models'
import {
  accountSchema,
  budgetMonthSchema,
  expenseCategorySchema,
  expenseItemSchema,
  importedTransactionSchema,
  incomeSchema,
} from '@/domain/budget/schema'

/** Version of the row snapshot format, independent of the document schema. */
export const ENTITY_SNAPSHOT_VERSION = 1 as const

/**
 * Fields every row carries. `ownerId` is not part of the pure conversion: the
 * transport adds it when it writes rows and drops it when it reads them.
 */
export interface RowMeta {
  /** ISO timestamp of the last change (the server owns it once rows are stored). */
  updatedAt: string
  /** Soft delete marker: null while the row is alive. */
  deletedAt: string | null
}

export interface BudgetMonthRow extends RowMeta {
  id: EntityId
  year: number
  month: number
  name: string
  createdAt: string
  /** The document's month `updatedAt`: when the user last edited the month. */
  editedAt: string
}

export interface BudgetIncomeRow extends RowMeta {
  id: EntityId
  monthId: EntityId
  name: string
  amountCents: number
  sortOrder: number
}

export interface BudgetAccountRow extends RowMeta {
  id: EntityId
  monthId: EntityId
  name: string
  plannedTransferCents: number
  sortOrder: number
}

export interface BudgetExpenseCategoryRow extends RowMeta {
  id: EntityId
  monthId: EntityId
  accountId: EntityId | null
  name: string
  sortOrder: number
}

export interface BudgetExpenseItemRow extends RowMeta {
  id: EntityId
  categoryId: EntityId
  name: string
  amountCents: number
  sortOrder: number
}

export interface ImportedTransactionRow extends ImportedTransaction, RowMeta {}

export interface UserSettingsRow {
  activeBudgetMonthId: EntityId | null
  updatedAt: string
}

/** The whole data set as per-entity rows, one array per table. */
export interface EntitySnapshot {
  schemaVersion: typeof ENTITY_SNAPSHOT_VERSION
  months: BudgetMonthRow[]
  incomes: BudgetIncomeRow[]
  accounts: BudgetAccountRow[]
  expenseCategories: BudgetExpenseCategoryRow[]
  expenseItems: BudgetExpenseItemRow[]
  importedTransactions: ImportedTransactionRow[]
  settings: UserSettingsRow
}

const idSchema = z.uuid()
const timestampSchema = z.iso.datetime()
const rowMetaShape = {
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
}

const monthRowSchema = budgetMonthSchema
  .omit({
    incomes: true,
    accounts: true,
    expenseCategories: true,
    updatedAt: true,
  })
  .extend({ editedAt: timestampSchema, ...rowMetaShape })

const incomeRowSchema = incomeSchema.extend({
  monthId: idSchema,
  ...rowMetaShape,
})

const accountRowSchema = accountSchema.extend({
  monthId: idSchema,
  ...rowMetaShape,
})

const expenseCategoryRowSchema = expenseCategorySchema
  .omit({ items: true })
  .extend({ monthId: idSchema, ...rowMetaShape })

const expenseItemRowSchema = expenseItemSchema.extend({
  categoryId: idSchema,
  ...rowMetaShape,
})

const importedTransactionRowSchema = importedTransactionSchema.extend(
  rowMetaShape,
)

const userSettingsRowSchema = z.object({
  activeBudgetMonthId: idSchema.nullable(),
  updatedAt: timestampSchema,
})

/**
 * Checks the shape of a snapshot: field types, UUIDs and the same limits as the
 * document schema. It does not check links between rows; the conversion back
 * to a document does that.
 */
export const entitySnapshotSchema = z.object({
  schemaVersion: z.literal(ENTITY_SNAPSHOT_VERSION),
  months: z.array(monthRowSchema),
  incomes: z.array(incomeRowSchema),
  accounts: z.array(accountRowSchema),
  expenseCategories: z.array(expenseCategoryRowSchema),
  expenseItems: z.array(expenseItemRowSchema),
  importedTransactions: z.array(importedTransactionRowSchema),
  settings: userSettingsRowSchema,
})
