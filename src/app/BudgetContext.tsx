import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { LocalBudgetStore } from '../data/LocalBudgetStore'
import type { BudgetRepository } from '../data/BudgetRepository'
import { CloudBudgetRepository } from '../data/cloud/CloudBudgetRepository'
import {
  IndexedDbBudgetRepository,
  loadLegacyBudgetData,
} from '../data/indexeddb/IndexedDbBudgetRepository'
import {
  createInitialAppData,
  findBudget,
  monthKey,
  seedMonthFrom,
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

export function BudgetProvider({ children, repository, migrateLegacy = true }: {
  children: ReactNode
  repository?: BudgetRepository
  migrateLegacy?: boolean
}) {
  const store = useMemo(
    () => new LocalBudgetStore(repository ?? new IndexedDbBudgetRepository()),
    [repository],
  )
  const [data, setData] = useState<AppData | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const saveRevision = useRef(0)
  const dataRef = useRef<AppData | null>(null)
  const initializationRef = useRef<Promise<AppData> | null>(null)
  // Month shown but not saved yet. Never written into `data`, the repository
  // or cloud sync until the first edit (see updateActiveBudget).
  const [virtualBudget, setVirtualBudget] = useState<BudgetMonth | null>(null)
  const virtualRef = useRef<BudgetMonth | null>(null)

  useEffect(() => {
    if (!(repository instanceof CloudBudgetRepository)) return
    const unwatch = repository.watch((next) => {
      dataRef.current = next
      setData(next)
    })
    void repository.sync()
    return unwatch
  }, [repository])

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        if (!initializationRef.current) {
          initializationRef.current = (async () => {
            const persisted = await store.load()
            const legacyData = persisted || !migrateLegacy ? null : await loadLegacyBudgetData()
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
  }, [store, migrateLegacy])

  useEffect(() => {
    // A page can return from the back/forward cache without React remounting.
    // Cloud watchers are disposed on scope unmount, not on a temporary pagehide.
    const closeStore = () => {
      if (!(repository instanceof CloudBudgetRepository)) store.close()
    }
    window.addEventListener('pagehide', closeStore)
    return () => window.removeEventListener('pagehide', closeStore)
  }, [store, repository])

  const persist = useCallback(
    (nextData: AppData) => {
      if (repository instanceof CloudBudgetRepository) repository.markLocalEdit()
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
    [store, repository],
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

  const setVirtual = useCallback((budget: BudgetMonth | null) => {
    virtualRef.current = budget
    setVirtualBudget(budget)
  }, [])

  // The virtual month only counts while no persisted month has its key (a
  // cloud sync or a restore may have created it in the meantime).
  const currentVirtual = useCallback((): BudgetMonth | null => {
    const virtual = virtualRef.current
    const current = dataRef.current
    if (!virtual || !current) return null
    return findBudget(current, virtual.year, virtual.month) ? null : virtual
  }, [])

  const setActiveBudget = useCallback(
    (id: string) => {
      setVirtual(null)
      commit((draft) => {
        if (draft.budgetMonths.some((budget) => budget.id === id)) {
          draft.settings.activeBudgetMonthId = id
        }
      })
    },
    [commit, setVirtual],
  )

  const openMonth = useCallback(
    (year: number, month: number) => {
      const current = dataRef.current
      if (
        !current ||
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12
      ) {
        return
      }
      const existing = findBudget(current, year, month)
      if (existing) {
        setActiveBudget(existing.id)
        return
      }
      const virtual = currentVirtual()
      if (virtual && virtual.year === year && virtual.month === month) return
      setVirtual(seedMonthFrom(current, year, month))
    },
    [currentVirtual, setActiveBudget, setVirtual],
  )

  const resetActiveBudget = useCallback(() => {
    const current = dataRef.current
    if (!current) return
    const virtual = currentVirtual()
    if (virtual) {
      setVirtual(seedMonthFrom(current, virtual.year, virtual.month))
      return
    }
    commit((draft) => {
      const index = draft.budgetMonths.findIndex(
        (budget) => budget.id === draft.settings.activeBudgetMonthId,
      )
      const active = draft.budgetMonths[index]
      if (!active) return
      const removedCategoryIds = new Set(
        active.expenseCategories.map((category) => category.id),
      )
      // Only months strictly before the active one are seed candidates.
      draft.budgetMonths[index] = {
        ...seedMonthFrom(draft, active.year, active.month),
        id: active.id,
        createdAt: active.createdAt,
      }
      draft.importedTransactions.forEach((transaction) => {
        if (
          transaction.categoryId &&
          removedCategoryIds.has(transaction.categoryId)
        ) {
          transaction.categoryId = null
        }
      })
    })
  }, [commit, currentVirtual, setVirtual])

  const updateActiveBudget = useCallback(
    (update: (budget: BudgetMonth) => void) => {
      const virtual = currentVirtual()
      commit((draft) => {
        let budget: BudgetMonth | undefined
        if (virtual) {
          // First edit of a virtual month: persist it now.
          budget = findBudget(draft, virtual.year, virtual.month)
          if (!budget) {
            budget = structuredClone(virtual)
            draft.budgetMonths.push(budget)
          }
          draft.settings.activeBudgetMonthId = budget.id
        } else {
          budget = draft.budgetMonths.find(
            (candidate) =>
              candidate.id === draft.settings.activeBudgetMonthId,
          )
        }
        if (!budget) return
        update(budget)
        const categoryIds = new Set(
          budget.expenseCategories.map((category) => category.id),
        )
        const key = monthKey(budget.year, budget.month)
        draft.importedTransactions.forEach((transaction) => {
          if (
            transaction.bookingDate.startsWith(key) &&
            transaction.categoryId &&
            !categoryIds.has(transaction.categoryId)
          ) {
            transaction.categoryId = null
          }
        })
        budget.updatedAt = new Date().toISOString()
      })
      if (virtual) setVirtual(null)
    },
    [commit, currentVirtual, setVirtual],
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
        setVirtual(null)
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
    [store, setVirtual],
  )

  const resetData = useCallback(async () => {
    await replaceData(createInitialAppData())
  }, [replaceData])

  const dismissError = useCallback(() => setError(null), [])

  const virtualActive =
    data &&
    virtualBudget &&
    !findBudget(data, virtualBudget.year, virtualBudget.month)
      ? virtualBudget
      : null

  const activeBudget = useMemo(
    () =>
      virtualActive ??
      (data
        ? (data.budgetMonths.find(
            (budget) => budget.id === data.settings.activeBudgetMonthId,
          ) ?? data.budgetMonths[0])
        : undefined),
    [data, virtualActive],
  )

  const savedMonthKeys = useMemo(
    () =>
      (data?.budgetMonths ?? [])
        .map((budget) => monthKey(budget.year, budget.month))
        .sort(),
    [data],
  )

  // Memoised so consumers only re-render when something they read changed.
  const contextValue = useMemo(
    () =>
      data && activeBudget
        ? {
            data,
            activeBudget,
            activeBudgetIsVirtual: virtualActive !== null,
            selectedYear: activeBudget.year,
            savedMonthKeys,
            saveStatus,
            error,
            openMonth,
            resetActiveBudget,
            setActiveBudget,
            updateActiveBudget,
            importTransactions,
            setTransactionCategory,
            setTransactionKind,
            deleteTransaction,
            deleteTransactionBatch,
            replaceData,
            resetData,
            dismissError,
          }
        : null,
    [
      data,
      activeBudget,
      virtualActive,
      savedMonthKeys,
      saveStatus,
      error,
      openMonth,
      resetActiveBudget,
      setActiveBudget,
      updateActiveBudget,
      importTransactions,
      setTransactionCategory,
      setTransactionKind,
      deleteTransaction,
      deleteTransactionBatch,
      replaceData,
      resetData,
      dismissError,
    ],
  )

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
    <BudgetContext.Provider value={contextValue}>
      {children}
    </BudgetContext.Provider>
  )
}
