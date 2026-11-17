import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BudgetRepository } from '../data/BudgetRepository'
import {
  createEmptyBudgetMonth,
  createInitialAppData,
} from '../domain/budget/factory'
import type { AppData, ImportedTransaction } from '../domain/budget/models'
import { parseAppData } from '../domain/budget/schema'
import { BudgetProvider } from './BudgetContext'
import { useBudget } from './budget-context'

class MemoryRepository implements BudgetRepository {
  saved: AppData | null
  saves = 0

  constructor(initial: AppData | null) {
    this.saved = initial
  }

  async load() {
    return this.saved ? structuredClone(this.saved) : null
  }

  async save(data: AppData) {
    this.saves += 1
    this.saved = structuredClone(data)
  }

  async clear() {
    this.saved = null
  }

  close() {}
}

function seededData(): AppData {
  const data = createInitialAppData(new Date(2026, 2, 1))
  const march = data.budgetMonths[0]!
  march.incomes[0]!.amountCents = 300_000
  return data
}

async function setup(initial: AppData = seededData()) {
  const repository = new MemoryRepository(initial)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BudgetProvider repository={repository} migrateLegacy={false}>
      {children}
    </BudgetProvider>
  )
  const hook = renderHook(() => useBudget(), { wrapper })
  await waitFor(() => expect(hook.result.current).not.toBeNull())
  await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'))
  repository.saves = 0
  return { hook, repository }
}

afterEach(cleanup)

describe('lazy month creation', () => {
  it('shows a virtual month without persisting it', async () => {
    const { hook, repository } = await setup()
    const persistedId = hook.result.current.data.settings.activeBudgetMonthId

    act(() => hook.result.current.openMonth(2026, 8))

    const current = hook.result.current
    expect(current.activeBudgetIsVirtual).toBe(true)
    expect(current.activeBudget.month).toBe(8)
    expect(current.selectedYear).toBe(2026)
    // Seeded from the nearest earlier month.
    expect(current.activeBudget.incomes[0]!.amountCents).toBe(300_000)
    expect(current.data.budgetMonths).toHaveLength(1)
    expect(current.data.settings.activeBudgetMonthId).toBe(persistedId)
    expect(current.savedMonthKeys).toEqual(['2026-03'])
    expect(repository.saves).toBe(0)
    expect(repository.saved!.budgetMonths).toHaveLength(1)
  })

  it('persists the month on the first edit only', async () => {
    const { hook, repository } = await setup()
    act(() => hook.result.current.openMonth(2026, 8))
    const virtualId = hook.result.current.activeBudget.id

    act(() =>
      hook.result.current.updateActiveBudget((budget) => {
        budget.incomes[0]!.amountCents = 123_00
      }),
    )

    await waitFor(() => expect(repository.saves).toBe(1))
    const current = hook.result.current
    expect(current.activeBudgetIsVirtual).toBe(false)
    expect(current.activeBudget.id).toBe(virtualId)
    expect(current.data.settings.activeBudgetMonthId).toBe(virtualId)
    expect(current.savedMonthKeys).toEqual(['2026-03', '2026-08'])
    const saved = repository.saved!
    expect(saved.budgetMonths).toHaveLength(2)
    expect(
      saved.budgetMonths.find((budget) => budget.month === 8)!.incomes[0]!
        .amountCents,
    ).toBe(123_00)
    expect(parseAppData(saved)).toEqual(saved)
  })

  it('opens January then August, persisting only the edited one', async () => {
    const { hook, repository } = await setup()

    act(() => hook.result.current.openMonth(2026, 1))
    // Nothing precedes January: empty month.
    expect(hook.result.current.activeBudget.incomes[0]!.amountCents).toBe(0)

    act(() => hook.result.current.openMonth(2026, 8))
    expect(hook.result.current.activeBudgetIsVirtual).toBe(true)
    expect(hook.result.current.activeBudget.month).toBe(8)

    act(() =>
      hook.result.current.updateActiveBudget((budget) => {
        budget.name = 'Summer'
      }),
    )

    await waitFor(() => expect(repository.saves).toBe(1))
    expect(hook.result.current.savedMonthKeys).toEqual(['2026-03', '2026-08'])
    expect(repository.saved!.budgetMonths.map((budget) => budget.month)).toEqual(
      [3, 8],
    )
  })

  it('returns to a persisted month without creating anything', async () => {
    const { hook, repository } = await setup()
    const marchId = hook.result.current.activeBudget.id

    act(() => hook.result.current.openMonth(2026, 8))
    act(() => hook.result.current.openMonth(2026, 3))

    expect(hook.result.current.activeBudgetIsVirtual).toBe(false)
    expect(hook.result.current.activeBudget.id).toBe(marchId)
    await waitFor(() => expect(repository.saved!.budgetMonths).toHaveLength(1))
  })

  it('ignores invalid months', async () => {
    const { hook } = await setup()
    act(() => hook.result.current.openMonth(2026, 13))
    act(() => hook.result.current.openMonth(2026, 0))
    expect(hook.result.current.activeBudgetIsVirtual).toBe(false)
    expect(hook.result.current.activeBudget.month).toBe(3)
  })
})

describe('resetActiveBudget', () => {
  it('re-seeds a persisted month from the earlier month and nulls orphaned categories', async () => {
    const data = seededData()
    const march = data.budgetMonths[0]!
    const april = createEmptyBudgetMonth(2026, 4)
    april.incomes[0]!.amountCents = 1
    data.budgetMonths.push(april)
    data.settings.activeBudgetMonthId = april.id
    const transaction: ImportedTransaction = {
      id: crypto.randomUUID(),
      provider: 'revolut-csv',
      sourceKey: 'a',
      sourceReference: null,
      importBatchId: crypto.randomUUID(),
      sourceFileName: 'a.csv',
      bookingDate: '2026-04-10',
      startedAt: null,
      completedAt: null,
      description: 'Rent',
      amountCents: -50_00,
      feeCents: 0,
      balanceCents: null,
      currency: 'EUR',
      transactionType: null,
      product: null,
      kind: 'expense',
      categoryId: april.expenseCategories[0]!.id,
      importedAt: new Date().toISOString(),
    }
    data.importedTransactions.push(transaction)
    parseAppData(data)

    const { hook, repository } = await setup(data)
    expect(hook.result.current.activeBudget.id).toBe(april.id)

    act(() => hook.result.current.resetActiveBudget())

    const current = hook.result.current
    expect(current.activeBudget.id).toBe(april.id)
    expect(current.activeBudget.month).toBe(4)
    expect(current.activeBudget.incomes[0]!.amountCents).toBe(
      march.incomes[0]!.amountCents,
    )
    expect(current.data.importedTransactions[0]!.categoryId).toBeNull()
    await waitFor(() => expect(repository.saves).toBe(1))
    expect(parseAppData(repository.saved!)).toEqual(repository.saved)
  })

  it('re-seeds a virtual month without saving', async () => {
    const { hook, repository } = await setup()
    act(() => hook.result.current.openMonth(2026, 8))
    const before = hook.result.current.activeBudget.id

    act(() => hook.result.current.resetActiveBudget())

    expect(hook.result.current.activeBudgetIsVirtual).toBe(true)
    expect(hook.result.current.activeBudget.id).not.toBe(before)
    expect(repository.saves).toBe(0)
  })
})
