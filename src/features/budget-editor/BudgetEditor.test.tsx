import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  BudgetContext,
  type BudgetContextValue,
} from '@/app/budget-context'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  createAccount,
  createEmptyBudgetMonth,
  createExpenseCategory,
  createExpenseItem,
  createIncome,
} from '@/domain/budget/factory'
import type { BudgetMonth } from '@/domain/budget/models'
import { BudgetEditor } from './BudgetEditor'

vi.mock('sonner', () => ({ toast: vi.fn() }))

function makeBudget(): BudgetMonth {
  const budget = createEmptyBudgetMonth(2026, 3)
  budget.incomes = [
    createIncome('Salary', 0),
    createIncome('Bonus', 1),
    createIncome('Gift', 2),
  ]
  budget.accounts = [createAccount('Checking', 0), createAccount('Savings', 1)]
  const housing = createExpenseCategory('Housing', 0, budget.accounts[0]!.id)
  housing.items = [createExpenseItem('Rent', 0), createExpenseItem('Power', 1)]
  budget.expenseCategories = [housing, createExpenseCategory('Food', 1)]
  return budget
}

let latest: BudgetMonth

function Harness({ children }: { children: ReactNode }) {
  const [budget, setBudget] = useState(makeBudget)
  useEffect(() => {
    latest = budget
  })
  const value = {
    activeBudget: budget,
    updateActiveBudget: (update: (draft: BudgetMonth) => void) =>
      setBudget((current) => {
        const draft = structuredClone(current)
        update(draft)
        return draft
      }),
  } as unknown as BudgetContextValue
  return (
    <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
  )
}

function renderEditor() {
  return render(
    <TooltipProvider>
      <ConfirmProvider>
        <Harness>
          <BudgetEditor />
        </Harness>
      </ConfirmProvider>
    </TooltipProvider>,
  )
}

function incomeNames() {
  return screen
    .getAllByLabelText(/^Income name/)
    .map((input) => (input as HTMLInputElement).value)
}

async function runMenu(
  user: ReturnType<typeof userEvent.setup>,
  rowName: string,
  item: 'Move up' | 'Move down' | 'Delete',
) {
  await user.click(
    screen.getByRole('button', { name: `Actions for ${rowName}` }),
  )
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

beforeEach(() => {
  vi.mocked(toast).mockClear()
})

afterEach(() => cleanup())

describe('BudgetEditor', () => {
  it('keeps the accessible names that other tests rely on', () => {
    renderEditor()
    expect(
      screen.getByRole('heading', { name: 'Build your month' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Income name 1')).toHaveValue('Salary')
    expect(screen.getByLabelText('Amount for Salary')).toBeInTheDocument()
    expect(screen.getByLabelText('Account name 2')).toHaveValue('Savings')
    expect(screen.getByLabelText('Transfer to Checking')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Expense name 2 in Housing'),
    ).toHaveValue('Power')
    expect(screen.getByLabelText('Account for Housing')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reorder Salary' }),
    ).toBeInTheDocument()
  })

  it('adds a row at the bottom and focuses its name with the text selected', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByRole('button', { name: 'Add income' }))

    const input = screen.getByLabelText('Income name 4') as HTMLInputElement
    expect(input).toHaveValue('New income')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('New income'.length)
    expect(latest.incomes.map((income) => income.sortOrder)).toEqual([
      0, 1, 2, 3,
    ])
  })

  it('adds an expense inside its own category', async () => {
    const user = userEvent.setup()
    renderEditor()

    const addButtons = screen.getAllByRole('button', { name: 'Add expense' })
    await user.click(addButtons[0]!)

    expect(latest.expenseCategories[0]!.items).toHaveLength(3)
    expect(latest.expenseCategories[1]!.items).toHaveLength(1)
    expect(screen.getByLabelText('Expense name 3 in Housing')).toHaveFocus()
  })

  it('reorders with the Move up / Move down menu using the keyboard', async () => {
    const user = userEvent.setup()
    renderEditor()

    const trigger = screen.getByRole('button', { name: 'Actions for Salary' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const moveDown = await screen.findByRole('menuitem', { name: 'Move down' })
    await waitFor(() => expect(moveDown).toHaveFocus())
    await user.keyboard('{Enter}')

    expect(incomeNames()).toEqual(['Bonus', 'Salary', 'Gift'])
    expect(latest.incomes.map((income) => income.sortOrder)).toEqual([0, 1, 2])

    await runMenu(user, 'Gift', 'Move up')
    expect(incomeNames()).toEqual(['Bonus', 'Gift', 'Salary'])
  })

  it('disables Move up on the first row and Move down on the last', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByRole('button', { name: 'Actions for Salary' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Move up' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('deletes a single row at once and restores it from the undo toast', async () => {
    const user = userEvent.setup()
    renderEditor()

    await runMenu(user, 'Bonus', 'Delete')

    expect(incomeNames()).toEqual(['Salary', 'Gift'])
    expect(toast).toHaveBeenCalledTimes(1)
    const [message, options] = vi.mocked(toast).mock.calls[0]!
    expect(message).toBe('Income deleted')

    const action = (
      options as { action: { label: string; onClick: () => void } }
    ).action
    expect(action.label).toBe('Undo')
    action.onClick()

    // `latest` is updated by an effect, so it can lag behind the DOM.
    await waitFor(() => {
      expect(incomeNames()).toEqual(['Salary', 'Bonus', 'Gift'])
      expect(latest.incomes.map((income) => income.sortOrder)).toEqual([
        0, 1, 2,
      ])
    })
  })

  it('asks for confirmation before deleting an account', async () => {
    const user = userEvent.setup()
    renderEditor()

    await runMenu(user, 'Checking', 'Delete')
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Delete Checking?',
    })
    expect(dialog).toHaveTextContent('1 category or categories')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
    expect(latest.accounts).toHaveLength(2)

    await runMenu(user, 'Checking', 'Delete')
    await user.click(
      await screen.findByRole('button', { name: 'Delete account' }),
    )

    await waitFor(() => expect(latest.accounts).toHaveLength(1))
    expect(latest.accounts[0]!.sortOrder).toBe(0)
    expect(latest.expenseCategories[0]!.accountId).toBeNull()
    expect(toast).not.toHaveBeenCalled()
  })

  it('asks for confirmation before deleting a category', async () => {
    const user = userEvent.setup()
    renderEditor()

    await runMenu(user, 'Food', 'Delete')
    await user.click(
      await screen.findByRole('button', { name: 'Delete category' }),
    )

    await waitFor(() => expect(latest.expenseCategories).toHaveLength(1))
    expect(latest.expenseCategories[0]!.name).toBe('Housing')
  })

  it('exposes a keyboard drag handle with announcements', async () => {
    const user = userEvent.setup()
    renderEditor()

    const handle = screen.getByRole('button', { name: 'Reorder Salary' })
    handle.focus()
    await user.keyboard(' ')
    await waitFor(() =>
      expect(document.body).toHaveTextContent('Salary is over position 1 of 3.'),
    )
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(document.body).toHaveTextContent(
        'Reordering cancelled. Salary did not move.',
      ),
    )
    expect(incomeNames()).toEqual(['Salary', 'Bonus', 'Gift'])
  })

  it('reorders a row by dragging its handle with the keyboard', async () => {
    // jsdom has no layout: stack the siblings of every element 40px apart so
    // dnd-kit can tell which row is above or below.
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const index = this.parentElement
          ? Array.from(this.parentElement.children).indexOf(this)
          : 0
        return new DOMRect(0, index * 40, 300, 40)
      })
    try {
      const user = userEvent.setup()
      renderEditor()

      screen.getByRole('button', { name: 'Reorder Salary' }).focus()
      await user.keyboard(' ')
      await user.keyboard('{ArrowDown}')
      await user.keyboard(' ')

      await waitFor(() =>
        expect(incomeNames()).toEqual(['Bonus', 'Salary', 'Gift']),
      )
      expect(latest.incomes.map((income) => income.sortOrder)).toEqual([
        0, 1, 2,
      ])
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps an invalid name in the field with an inline error', async () => {
    const user = userEvent.setup()
    renderEditor()

    const input = screen.getByLabelText('Income name 1')
    await user.clear(input)
    await user.tab()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A name is required.',
    )
    expect(latest.incomes[0]!.name).toBe('Salary')
  })
})
