import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { LocalBudgetStore } from '../data/LocalBudgetStore'
import {
  IndexedDbBudgetRepository,
  loadLegacyBudgetData,
} from '../data/indexeddb/IndexedDbBudgetRepository'
import {
  cloneBudgetMonth,
  createEmptyBudgetMonth,
  createInitialAppData,
  nextMonth,
} from '../domain/budget/factory'
import type {
  AppData,
  BudgetMonth,
  ImportedTransaction,
  ImportedTransactionKind,
} from '../domain/budget/models'
import { parseAppData } from '../domain/budget/schema'
import {
  BudgetContext,
  type SaveStatus,
} from './budget-context'

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.'
}

function normalizeActiveBudget(data: AppData): AppData {
  if (
    data.settings.activeBudgetMonthId &&
    data.budgetMonths.some(
      (budget) => budget.id === data.settings.activeBudgetMonthId,
    )
  ) {
    return data
  }

  return {
    ...data,
    settings: {
      ...data.settings,
      activeBudgetMonthId: data.budgetMonths[0]?.id ?? null,
    },
  }
}

export function BudgetProvider({ children }: { children: ReactNode }) {
  const store = useMemo(
    () => new LocalBudgetStore(new IndexedDbBudgetRepository()),
    [],
  )
  const [data, setData] = useState<AppData | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const saveRevision = useRef(0)
  const dataRef = useRef<AppData | null>(null)
  const initializationRef = useRef<Promise<AppData> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        if (!initializationRef.current) {
          initializationRef.current = (async () => {
            const persisted = await store.load()
            const legacyData = persisted ? null : await loadLegacyBudgetData()
            const initial = normalizeActiveBudget(
              persisted ?? legacyData ?? createInitialAppData(),
            )
            if (!persisted) {
              await store.save(initial)
            }
            return initial
          })()
        }
        const initial = await initializationRef.current
        if (!cancelled) {
          dataRef.current = initial
          setData(initial)
          setSaveStatus('saved')
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            `Unable to open local data: ${getErrorMessage(loadError)}`,
          )
          setSaveStatus('error')
        }
      }
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [store])

  useEffect(() => {
    const closeStore = () => store.close()
    window.addEventListener('pagehide', closeStore)
    return () => window.removeEventListener('pagehide', closeStore)
  }, [store])

  const persist = useCallback(
    (nextData: AppData) => {
      const revision = ++saveRevision.current
      setSaveStatus('saving')
      void store
        .save(nextData)
        .then(() => {
          if (saveRevision.current === revision) {
            setSaveStatus('saved')
          }
        })
        .catch((saveError: unknown) => {
          setError(
            `Local save failed: ${getErrorMessage(saveError)}`,
          )
          setSaveStatus('error')
        })
    },
    [store],
  )

  const commit = useCallback(
    (update: (draft: AppData) => void) => {
      const current = dataRef.current
      if (!current) return
      const draft = structuredClone(current)
      update(draft)
      dataRef.current = draft
      setData(draft)
      persist(draft)
    },
    [persist],
  )

  const setActiveBudget = useCallback(
    (id: string) => {
      commit((draft) => {
        if (draft.budgetMonths.some((budget) => budget.id === id)) {
          draft.settings.activeBudgetMonthId = id
        }
      })
    },
    [commit],
  )

  const goToAdjacentBudget = useCallback(
    (direction: -1 | 1) => {
      if (!data) return
      const sorted = [...data.budgetMonths].sort(
        (left, right) =>
          left.year * 12 + left.month - (right.year * 12 + right.month),
      )
      const currentIndex = sorted.findIndex(
        (budget) => budget.id === data.settings.activeBudgetMonthId,
      )
      const target = sorted[currentIndex + direction]
      if (target) setActiveBudget(target.id)
    },
    [data, setActiveBudget],
  )

  const createFollowingBudget = useCallback(
    (copyCurrent: boolean) => {
      if (!data) return
      const active = data.budgetMonths.find(
        (budget) => budget.id === data.settings.activeBudgetMonthId,
      )
      if (!active) return
      const following = nextMonth(active.year, active.month)
      const existing = data.budgetMonths.find(
        (budget) =>
          budget.year === following.year && budget.month === following.month,
      )
      if (existing) {
        setActiveBudget(existing.id)
        return
      }

      const budget = copyCurrent
        ? cloneBudgetMonth(active, following.year, following.month)
        : createEmptyBudgetMonth(following.year, following.month)
      commit((draft) => {
        draft.budgetMonths.push(budget)
        draft.settings.activeBudgetMonthId = budget.id
      })
    },
    [commit, data, setActiveBudget],
  )

  const deleteActiveBudget = useCallback(() => {
    if (!data || data.budgetMonths.length <= 1) return false
    const activeId = data.settings.activeBudgetMonthId
    const sorted = [...data.budgetMonths].sort(
      (left, right) =>
        left.year * 12 + left.month - (right.year * 12 + right.month),
    )
    const activeIndex = sorted.findIndex((budget) => budget.id === activeId)
    const replacement = sorted[activeIndex - 1] ?? sorted[activeIndex + 1]

    commit((draft) => {
      const removedCategoryIds = new Set(
        draft.budgetMonths
          .find((budget) => budget.id === activeId)
          ?.expenseCategories.map((category) => category.id) ?? [],
      )
      draft.budgetMonths = draft.budgetMonths.filter(
        (budget) => budget.id !== activeId,
      )
      draft.importedTransactions.forEach((transaction) => {
        if (
          transaction.categoryId &&
          removedCategoryIds.has(transaction.categoryId)
        ) {
          transaction.categoryId = null
        }
      })
      draft.settings.activeBudgetMonthId = replacement?.id ?? null
    })
    return true
  }, [commit, data])

  const updateActiveBudget = useCallback(
    (update: (budget: BudgetMonth) => void) => {
      commit((draft) => {
        const budget = draft.budgetMonths.find(
          (candidate) =>
            candidate.id === draft.settings.activeBudgetMonthId,
        )
        if (!budget) return
        update(budget)
        const categoryIds = new Set(
          budget.expenseCategories.map((category) => category.id),
        )
        const budgetMonth = `${budget.year}-${String(budget.month).padStart(2, '0')}`
        draft.importedTransactions.forEach((transaction) => {
          if (
            transaction.bookingDate.startsWith(budgetMonth) &&
            transaction.categoryId &&
            !categoryIds.has(transaction.categoryId)
          ) {
            transaction.categoryId = null
          }
        })
        budget.updatedAt = new Date().toISOString()
      })
    },
    [commit],
  )

  const importTransactions = useCallback(
    (transactions: ImportedTransaction[]) => {
      const existingSourceKeys = new Set(
        dataRef.current?.importedTransactions.map(
          (transaction) => transaction.sourceKey,
        ) ?? [],
      )
      const sourceKeysInBatch = new Set<string>()
      const newTransactions = transactions.filter((transaction) => {
        if (
          existingSourceKeys.has(transaction.sourceKey) ||
          sourceKeysInBatch.has(transaction.sourceKey)
        ) {
          return false
        }
        sourceKeysInBatch.add(transaction.sourceKey)
        return true
      })

      if (newTransactions.length > 0) {
        commit((draft) => {
          draft.importedTransactions.push(...newTransactions)
        })
      }
      return newTransactions.length
    },
    [commit],
  )

  const setTransactionCategory = useCallback(
    (transactionId: string, categoryId: string | null) => {
      commit((draft) => {
        const transaction = draft.importedTransactions.find(
          (candidate) => candidate.id === transactionId,
        )
        if (!transaction) return

        if (categoryId) {
          const monthKey = transaction.bookingDate.slice(0, 7)
          const budget = draft.budgetMonths.find(
            (candidate) =>
              `${candidate.year}-${String(candidate.month).padStart(2, '0')}` ===
              monthKey,
          )
          if (
            !budget?.expenseCategories.some(
              (category) => category.id === categoryId,
            )
          ) {
            return
          }
        }
        transaction.categoryId = categoryId
      })
    },
    [commit],
  )

  const setTransactionKind = useCallback(
    (transactionId: string, kind: ImportedTransactionKind) => {
      commit((draft) => {
        const transaction = draft.importedTransactions.find(
          (candidate) => candidate.id === transactionId,
        )
        if (!transaction) return
        transaction.kind = kind
        if (kind !== 'expense') transaction.categoryId = null
      })
    },
    [commit],
  )

  const deleteTransaction = useCallback(
    (transactionId: string) => {
      commit((draft) => {
        draft.importedTransactions = draft.importedTransactions.filter(
          (transaction) => transaction.id !== transactionId,
        )
      })
    },
    [commit],
  )

  const deleteTransactionBatch = useCallback(
    (batchId: string) => {
      const count =
        dataRef.current?.importedTransactions.filter(
          (transaction) => transaction.importBatchId === batchId,
        ).length ?? 0
      if (count > 0) {
        commit((draft) => {
          draft.importedTransactions = draft.importedTransactions.filter(
            (transaction) => transaction.importBatchId !== batchId,
          )
        })
      }
      return count
    },
    [commit],
  )

  const replaceData = useCallback(
    async (replacement: AppData) => {
      const validated = normalizeActiveBudget(parseAppData(replacement))
      setSaveStatus('saving')
      try {
        await store.replace(validated)
        dataRef.current = validated
        setData(validated)
        setSaveStatus('saved')
      } catch (replaceError) {
        setError(
          `Restore failed: ${getErrorMessage(replaceError)}`,
        )
        setSaveStatus('error')
        throw replaceError
      }
    },
    [store],
  )

  const resetData = useCallback(async () => {
    await replaceData(createInitialAppData())
  }, [replaceData])

  if (!data) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="loading-mark" aria-hidden="true">
          €
        </div>
        <p>
          {saveStatus === 'error'
            ? (error ?? 'Unable to load your budget.')
            : 'Opening your budget…'}
        </p>
      </main>
    )
  }

  const activeBudget =
    data.budgetMonths.find(
      (budget) => budget.id === data.settings.activeBudgetMonthId,
    ) ?? data.budgetMonths[0]

  if (!activeBudget) {
    return (
      <main className="loading-screen">
        <p>No budget is available.</p>
        <button type="button" onClick={() => void resetData()}>
          Create a budget
        </button>
      </main>
    )
  }

  return (
    <BudgetContext.Provider
      value={{
        data,
        activeBudget,
        saveStatus,
        error,
        setActiveBudget,
        goToAdjacentBudget,
        createFollowingBudget,
        deleteActiveBudget,
        updateActiveBudget,
        importTransactions,
        setTransactionCategory,
        setTransactionKind,
        deleteTransaction,
        deleteTransactionBatch,
        replaceData,
        resetData,
        dismissError: () => setError(null),
      }}
    >
      {children}
    </BudgetContext.Provider>
  )
}
