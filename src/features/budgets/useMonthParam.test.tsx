import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetProvider } from '@/app/BudgetContext'
import { useBudget } from '@/app/budget-context'
import type { BudgetRepository } from '@/data/BudgetRepository'
import { createInitialAppData } from '@/domain/budget/factory'
import type { AppData } from '@/domain/budget/models'
import { useMonthParam } from './useMonthParam'

class MemoryRepository implements BudgetRepository {
  saved: AppData | null
  saves = 0

  constructor(initial: AppData) {
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

afterEach(cleanup)

async function setup(m: string | undefined) {
  // March 2026 is the only saved month, and the persisted active one.
  const repository = new MemoryRepository(
    createInitialAppData(new Date(2026, 2, 1)),
  )
  const writeMonth = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BudgetProvider repository={repository} migrateLegacy={false}>
      {children}
    </BudgetProvider>
  )
  const hook = renderHook(
    () => {
      useMonthParam(m, writeMonth)
      return useBudget()
    },
    { wrapper },
  )
  await waitFor(() => expect(hook.result.current).not.toBeNull())
  await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'))
  return { hook, repository, writeMonth }
}

describe('useMonthParam', () => {
  it('opens the month named by `m` as a virtual month, without saving it', async () => {
    const { hook, repository, writeMonth } = await setup('2026-08')

    await waitFor(() => expect(hook.result.current.activeBudget.month).toBe(8))
    expect(hook.result.current.activeBudget.year).toBe(2026)
    expect(hook.result.current.activeBudgetIsVirtual).toBe(true)
    expect(hook.result.current.savedMonthKeys).toEqual(['2026-03'])
    expect(repository.saved!.budgetMonths).toHaveLength(1)
    expect(writeMonth).not.toHaveBeenCalled()
  })

  it('opens a month of another year', async () => {
    const { hook } = await setup('2031-01')

    await waitFor(() =>
      expect(hook.result.current.activeBudget.year).toBe(2031),
    )
    expect(hook.result.current.activeBudget.month).toBe(1)
    expect(hook.result.current.selectedYear).toBe(2031)
  })

  it('opens a saved month as a real one', async () => {
    const { hook } = await setup('2026-03')

    expect(hook.result.current.activeBudgetIsVirtual).toBe(false)
    expect(hook.result.current.activeBudget.month).toBe(3)
  })

  it('writes the active month into the URL when `m` is absent', async () => {
    const { hook, writeMonth } = await setup(undefined)

    expect(writeMonth).toHaveBeenCalledWith('2026-03')
    expect(hook.result.current.activeBudget.month).toBe(3)
    expect(hook.result.current.activeBudgetIsVirtual).toBe(false)
  })
})
