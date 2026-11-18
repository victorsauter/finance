import { useState } from 'react'
import { toast } from 'sonner'
import { useBudget } from '@/app/budget-context'
import { useConfirm } from '@/components/ui/confirm-context'
import {
  createAccount,
  createExpenseCategory,
  createExpenseItem,
  createIncome,
} from '@/domain/budget/factory'
import type { BudgetMonth } from '@/domain/budget/models'
import {
  insertAt,
  moveItem,
  removeById,
  reorderById,
  type Identified,
  type Ordered,
} from '@/domain/budget/ordering'

/** Which ordered list of the month a row belongs to. */
export type ListRef =
  | { kind: 'incomes' }
  | { kind: 'accounts' }
  | { kind: 'categories' }
  | { kind: 'items'; categoryId: string }

type Row = Ordered & Identified & { name: string }

function getList(budget: BudgetMonth, ref: ListRef): Row[] | undefined {
  switch (ref.kind) {
    case 'incomes':
      return budget.incomes
    case 'accounts':
      return budget.accounts
    case 'categories':
      return budget.expenseCategories
    case 'items':
      return budget.expenseCategories.find(
        (category) => category.id === ref.categoryId,
      )?.items
  }
}

export type BudgetEditorApi = ReturnType<typeof useBudgetEditor>

/**
 * Every mutation of the planning editor, all routed through
 * `updateActiveBudget`.
 *
 * Delete policy (one rule for the whole editor):
 * - accounts and categories have knock-on effects (unassigned categories, lost
 *   expenses) so they ask for confirmation first;
 * - single rows (income, expense) are removed at once and an "Undo" toast puts
 *   them back at the same position.
 */
export function useBudgetEditor() {
  const { activeBudget, updateActiveBudget } = useBudget()
  const confirm = useConfirm()
  /** Id of the row just added: its name field takes focus when it mounts. */
  const [focusId, setFocusId] = useState<string | null>(null)

  const add = (ref: ListRef) => {
    const budget = activeBudget
    let created: { id: string }
    switch (ref.kind) {
      case 'incomes':
        created = createIncome('New income', budget.incomes.length)
        break
      case 'accounts':
        created = createAccount('New account', budget.accounts.length)
        break
      case 'categories':
        created = createExpenseCategory(
          'New category',
          budget.expenseCategories.length,
          budget.accounts[0]?.id ?? null,
        )
        break
      case 'items': {
        const count = getList(budget, ref)?.length ?? 0
        created = createExpenseItem('New expense', count)
        break
      }
    }
    setFocusId(created.id)
    updateActiveBudget((draft) => {
      const list = getList(draft, ref)
      if (list) list.push(created as Row)
    })
  }

  const updateRow = (ref: ListRef, id: string, change: (row: Row) => void) =>
    updateActiveBudget((draft) => {
      const row = getList(draft, ref)?.find((candidate) => candidate.id === id)
      if (row) change(row)
    })

  const rename = (ref: ListRef, id: string, name: string) =>
    updateRow(ref, id, (row) => {
      row.name = name
    })

  const setAmount = (ref: ListRef, id: string, cents: number) =>
    updateActiveBudget((draft) => {
      switch (ref.kind) {
        case 'incomes': {
          const income = draft.incomes.find((row) => row.id === id)
          if (income) income.amountCents = cents
          return
        }
        case 'accounts': {
          const account = draft.accounts.find((row) => row.id === id)
          if (account) account.plannedTransferCents = cents
          return
        }
        case 'items': {
          const item = draft.expenseCategories
            .find((category) => category.id === ref.categoryId)
            ?.items.find((row) => row.id === id)
          if (item) item.amountCents = cents
          return
        }
        case 'categories':
          return
      }
    })

  const setCategoryAccount = (categoryId: string, accountId: string | null) =>
    updateActiveBudget((draft) => {
      const category = draft.expenseCategories.find(
        (candidate) => candidate.id === categoryId,
      )
      if (category) category.accountId = accountId
    })

  const move = (ref: ListRef, index: number, direction: -1 | 1) =>
    updateActiveBudget((draft) => {
      const list = getList(draft, ref)
      if (list) moveItem(list, index, direction)
    })

  const reorder = (ref: ListRef, activeId: string, overId: string) =>
    updateActiveBudget((draft) => {
      const list = getList(draft, ref)
      if (list) reorderById(list, activeId, overId)
    })

  const removeWithUndo = (ref: ListRef, id: string, noun: string) => {
    const monthId = activeBudget.id
    // Read what is removed from the current snapshot, not from a side effect
    // of the mutator, so the Undo never depends on when updateActiveBudget
    // runs it.
    const index =
      getList(activeBudget, ref)?.findIndex((row) => row.id === id) ?? -1
    const snapshot = getList(activeBudget, ref)?.[index]
    if (!snapshot) return
    const item = structuredClone(snapshot)
    updateActiveBudget((draft) => {
      const list = getList(draft, ref)
      if (list) removeById(list, id)
    })
    toast(`${noun} deleted`, {
      description: item.name,
      action: {
        label: 'Undo',
        onClick: () =>
          updateActiveBudget((draft) => {
            if (draft.id !== monthId) return
            const list = getList(draft, ref)
            if (list && !list.some((row) => row.id === item.id)) {
              insertAt(list, item, index)
            }
          }),
      },
    })
  }

  const removeAccount = async (id: string, name: string) => {
    const affected = activeBudget.expenseCategories.filter(
      (category) => category.accountId === id,
    ).length
    const confirmed = await confirm({
      title: `Delete ${name}?`,
      message:
        affected > 0
          ? `${affected} category or categories use this account. They will become unassigned.`
          : 'This account will be removed from the budget.',
      confirmLabel: 'Delete account',
      tone: 'danger',
    })
    if (!confirmed) return
    updateActiveBudget((draft) => {
      removeById(draft.accounts, id)
      draft.expenseCategories.forEach((category) => {
        if (category.accountId === id) category.accountId = null
      })
    })
  }

  const removeCategory = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: `Delete ${name}?`,
      message: 'The category and all its expenses will be removed.',
      confirmLabel: 'Delete category',
      tone: 'danger',
    })
    if (!confirmed) return
    updateActiveBudget((draft) => {
      removeById(draft.expenseCategories, id)
    })
  }

  const remove = (ref: ListRef, id: string, name: string) => {
    switch (ref.kind) {
      case 'accounts':
        return void removeAccount(id, name)
      case 'categories':
        return void removeCategory(id, name)
      case 'incomes':
        return removeWithUndo(ref, id, 'Income')
      case 'items':
        return removeWithUndo(ref, id, 'Expense')
    }
  }

  return {
    budget: activeBudget,
    focusId,
    add,
    rename,
    setAmount,
    setCategoryAccount,
    move,
    reorder,
    remove,
  }
}
