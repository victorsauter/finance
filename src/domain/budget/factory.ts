import type {
  AppData,
  BudgetMonth,
  ExpenseCategory,
  ExpenseItem,
  Income,
  Account,
} from './models'
import {
  CURRENT_SCHEMA_VERSION,
  MAX_BUDGET_YEAR,
  MIN_BUDGET_YEAR,
} from './models'

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

export function previousMonth(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 }
}

/** Canonical `YYYY-MM` key of a budget month. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** True when the month can be stored: a real month of a supported year. */
export function isBudgetMonthInRange(year: number, month: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    year >= MIN_BUDGET_YEAR &&
    year <= MAX_BUDGET_YEAR &&
    month >= 1 &&
    month <= 12
  )
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month
}

export function findBudget(
  data: Pick<AppData, 'budgetMonths'>,
  year: number,
  month: number,
): BudgetMonth | undefined {
  return data.budgetMonths.find(
    (budget) => budget.year === year && budget.month === month,
  )
}

/**
 * Builds the content of a month that does not exist yet: a copy of the
 * nearest earlier persisted month (fresh identifiers), or an empty month when
 * nothing precedes it.
 */
export function seedMonthFrom(
  data: Pick<AppData, 'budgetMonths'>,
  year: number,
  month: number,
): BudgetMonth {
  const target = monthIndex(year, month)
  let nearest: BudgetMonth | undefined
  for (const budget of data.budgetMonths) {
    const index = monthIndex(budget.year, budget.month)
    if (
      index < target &&
      (!nearest || index > monthIndex(nearest.year, nearest.month))
    ) {
      nearest = budget
    }
  }

  return nearest
    ? cloneBudgetMonth(nearest, year, month)
    : createEmptyBudgetMonth(year, month)
}
