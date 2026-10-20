import { z } from 'zod'
import { CURRENT_SCHEMA_VERSION } from './models'

const idSchema = z.uuid()
const centsSchema = z.number().int().nonnegative()
const signedCentsSchema = z.number().int().refine((value) => value !== 0, {
  message: 'The transaction amount cannot be zero.',
})
const orderedEntitySchema = {
  id: idSchema,
  name: z.string().trim().min(1),
  sortOrder: z.number().int().nonnegative(),
}

export const incomeSchema = z.object({
  ...orderedEntitySchema,
  amountCents: centsSchema,
})

export const accountSchema = z.object({
  ...orderedEntitySchema,
  plannedTransferCents: centsSchema,
})

export const expenseItemSchema = z.object({
  ...orderedEntitySchema,
  amountCents: centsSchema,
})

export const expenseCategorySchema = z.object({
  ...orderedEntitySchema,
  accountId: idSchema.nullable(),
  items: z.array(expenseItemSchema),
})

export const budgetMonthSchema = z.object({
  id: idSchema,
  year: z.number().int().min(2000).max(2200),
  month: z.number().int().min(1).max(12),
  name: z.string().trim().min(1),
  incomes: z.array(incomeSchema),
  accounts: z.array(accountSchema),
  expenseCategories: z.array(expenseCategorySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const importedTransactionSchema = z.object({
  id: idSchema,
  provider: z.literal('revolut-csv'),
  sourceKey: z.string().trim().min(1).max(200),
  sourceReference: z.string().trim().min(1).max(200).nullable(),
  importBatchId: idSchema,
  sourceFileName: z.string().trim().min(1).max(255),
  bookingDate: z.iso.date(),
  startedAt: z.string().trim().min(1).max(100).nullable(),
  completedAt: z.string().trim().min(1).max(100).nullable(),
  description: z.string().trim().min(1).max(500),
  amountCents: signedCentsSchema,
  feeCents: centsSchema,
  balanceCents: z.number().int().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  transactionType: z.string().trim().min(1).max(100).nullable(),
  product: z.string().trim().min(1).max(100).nullable(),
  kind: z.enum(['expense', 'income', 'transfer']),
  categoryId: idSchema.nullable(),
  importedAt: z.iso.datetime(),
})

const appDataV1Schema = z.object({
  schemaVersion: z.literal(1),
  settings: z.object({
    activeBudgetMonthId: idSchema.nullable(),
  }),
  budgetMonths: z.array(budgetMonthSchema).min(1),
})

export const appDataSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  settings: z.object({
    activeBudgetMonthId: idSchema.nullable(),
  }),
  budgetMonths: z.array(budgetMonthSchema).min(1),
  importedTransactions: z.array(importedTransactionSchema),
}).superRefine((data, context) => {
  const activeBudgetExists = data.budgetMonths.some(
    (budget) => budget.id === data.settings.activeBudgetMonthId,
  )
  if (!activeBudgetExists) {
    context.addIssue({
      code: 'custom',
      message: 'The active budget does not match any month.',
      path: ['settings', 'activeBudgetMonthId'],
    })
  }

  const monthKeys = new Set<string>()
  const entityIds = new Set<string>()
  const categoryIdsByMonth = new Map<string, Set<string>>()
  const registerId = (id: string, path: Array<string | number>) => {
    if (entityIds.has(id)) {
      context.addIssue({
        code: 'custom',
        message: 'This identifier is used more than once.',
        path,
      })
    }
    entityIds.add(id)
  }

  data.budgetMonths.forEach((budget, budgetIndex) => {
    const monthKey = `${budget.year}-${String(budget.month).padStart(2, '0')}`
    if (monthKeys.has(monthKey)) {
      context.addIssue({
        code: 'custom',
        message: 'Two budgets use the same month.',
        path: ['budgetMonths', budgetIndex],
      })
    }
    monthKeys.add(monthKey)
    const categoryIds = new Set<string>()
    categoryIdsByMonth.set(monthKey, categoryIds)
    registerId(budget.id, ['budgetMonths', budgetIndex, 'id'])

    budget.incomes.forEach((income, incomeIndex) =>
      registerId(income.id, [
        'budgetMonths',
        budgetIndex,
        'incomes',
        incomeIndex,
        'id',
      ]),
    )
    const accountIds = new Set<string>()
    budget.accounts.forEach((account, accountIndex) => {
      accountIds.add(account.id)
      registerId(account.id, [
        'budgetMonths',
        budgetIndex,
        'accounts',
        accountIndex,
        'id',
      ])
    })
    budget.expenseCategories.forEach((category, categoryIndex) => {
      categoryIds.add(category.id)
      registerId(category.id, [
        'budgetMonths',
        budgetIndex,
        'expenseCategories',
        categoryIndex,
        'id',
      ])
      if (category.accountId && !accountIds.has(category.accountId)) {
        context.addIssue({
          code: 'custom',
          message: 'The account assigned to this category cannot be found.',
          path: [
            'budgetMonths',
            budgetIndex,
            'expenseCategories',
            categoryIndex,
            'accountId',
          ],
        })
      }
      category.items.forEach((item, itemIndex) =>
        registerId(item.id, [
          'budgetMonths',
          budgetIndex,
          'expenseCategories',
          categoryIndex,
          'items',
          itemIndex,
          'id',
        ]),
      )
    })
  })

  const sourceKeys = new Set<string>()
  data.importedTransactions.forEach((transaction, transactionIndex) => {
    registerId(transaction.id, [
      'importedTransactions',
      transactionIndex,
      'id',
    ])

    if (sourceKeys.has(transaction.sourceKey)) {
      context.addIssue({
        code: 'custom',
        message: 'This bank transaction has been imported more than once.',
        path: ['importedTransactions', transactionIndex, 'sourceKey'],
      })
    }
    sourceKeys.add(transaction.sourceKey)

    if (transaction.categoryId) {
      const monthKey = transaction.bookingDate.slice(0, 7)
      const categoryIds = categoryIdsByMonth.get(monthKey)
      if (!categoryIds?.has(transaction.categoryId)) {
        context.addIssue({
          code: 'custom',
          message:
            'The category assigned to this transaction cannot be found for its month.',
          path: ['importedTransactions', transactionIndex, 'categoryId'],
        })
      }
    }
  })
})

export function parseAppData(value: unknown) {
  const candidate =
    typeof value === 'object' && value !== null && 'schemaVersion' in value
      ? value
      : null

  if (candidate?.schemaVersion === 1) {
    const legacy = appDataV1Schema.parse(candidate)
    return appDataSchema.parse({
      ...legacy,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      importedTransactions: [],
    })
  }

  return appDataSchema.parse(value)
}
