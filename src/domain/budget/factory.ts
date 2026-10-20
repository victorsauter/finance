import type {
  AppData,
  BudgetMonth,
  ExpenseCategory,
  ExpenseItem,
  Income,
  Account,
} from './models'
import { CURRENT_SCHEMA_VERSION } from './models'

export function createId(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

export function getMonthName(year: number, month: number): string {
  const label = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))

  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function createIncome(name: string, sortOrder: number): Income {
  return { id: createId(), name, amountCents: 0, sortOrder }
}

export function createAccount(name: string, sortOrder: number): Account {
  return { id: createId(), name, plannedTransferCents: 0, sortOrder }
}

export function createExpenseItem(name: string, sortOrder: number): ExpenseItem {
  return { id: createId(), name, amountCents: 0, sortOrder }
}

export function createExpenseCategory(
  name: string,
  sortOrder: number,
  accountId: string | null = null,
): ExpenseCategory {
  return {
    id: createId(),
    name,
    accountId,
    items: [createExpenseItem('New expense', 0)],
    sortOrder,
  }
}

export function createEmptyBudgetMonth(year: number, month: number): BudgetMonth {
  const timestamp = now()
  const account = createAccount('Main account', 0)

  return {
    id: createId(),
    year,
    month,
    name: getMonthName(year, month),
    incomes: [createIncome('Main income', 0)],
    accounts: [account],
    expenseCategories: [
      {
        ...createExpenseCategory('Housing', 0, account.id),
        items: [createExpenseItem('Rent / mortgage', 0)],
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createInitialAppData(date = new Date()): AppData {
  const budget = createEmptyBudgetMonth(date.getFullYear(), date.getMonth() + 1)
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { activeBudgetMonthId: budget.id },
    budgetMonths: [budget],
    importedTransactions: [],
  }
}

export function cloneBudgetMonth(
  source: BudgetMonth,
  year: number,
  month: number,
): BudgetMonth {
  const timestamp = now()
  const accountIds = new Map<string, string>()
  const accounts = source.accounts.map((account) => {
    const id = createId()
    accountIds.set(account.id, id)
    return { ...account, id }
  })

  return {
    ...source,
    id: createId(),
    year,
    month,
    name: getMonthName(year, month),
    incomes: source.incomes.map((income) => ({ ...income, id: createId() })),
    accounts,
    expenseCategories: source.expenseCategories.map((category) => ({
      ...category,
      id: createId(),
      accountId: category.accountId
        ? (accountIds.get(category.accountId) ?? null)
        : null,
      items: category.items.map((item) => ({ ...item, id: createId() })),
    })),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function nextMonth(year: number, month: number) {
  return month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 }
}
