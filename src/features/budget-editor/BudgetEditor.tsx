import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
} from 'lucide-react'
import { useBudget } from '../../app/budget-context'
import { MoneyInput } from '../../components/forms/MoneyInput'
import { NameInput } from '../../components/forms/NameInput'
import {
  createAccount,
  createExpenseCategory,
  createExpenseItem,
  createIncome,
} from '../../domain/budget/factory'
import { formatMoney } from '../../domain/budget/money'

interface OrderedItem {
  sortOrder: number
}

function resequence<T extends OrderedItem>(items: T[]) {
  items.forEach((item, index) => {
    item.sortOrder = index
  })
}

function moveItem<T extends OrderedItem>(
  items: T[],
  index: number,
  direction: -1 | 1,
) {
  const target = index + direction
  if (target < 0 || target >= items.length) return
  const [item] = items.splice(index, 1)
  if (!item) return
  items.splice(target, 0, item)
  resequence(items)
}

interface RowActionsProps {
  label: string
  index: number
  count: number
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}

function RowActions({
  label,
  index,
  count,
  onMove,
  onDelete,
}: RowActionsProps) {
  return (
    <span className="row-actions">
      <button
        type="button"
        className="mini-button"
        disabled={index === 0}
        aria-label={`Move ${label} up`}
        onClick={() => onMove(-1)}
      >
        <ArrowUp aria-hidden="true" size={15} />
      </button>
      <button
        type="button"
        className="mini-button"
        disabled={index === count - 1}
        aria-label={`Move ${label} down`}
        onClick={() => onMove(1)}
      >
        <ArrowDown aria-hidden="true" size={15} />
      </button>
      <button
        type="button"
        className="mini-button delete"
        aria-label={`Delete ${label}`}
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" size={15} />
      </button>
    </span>
  )
}

export function BudgetEditor() {
  const { activeBudget, updateActiveBudget } = useBudget()

  const deleteAccount = (accountId: string, name: string) => {
    const categoryCount = activeBudget.expenseCategories.filter(
      (category) => category.accountId === accountId,
    ).length
    const message =
      categoryCount > 0
        ? `${categoryCount} category or categories use ${name}. They will become unassigned. Continue?`
        : `Delete the ${name} account?`
    if (!window.confirm(message)) return

    updateActiveBudget((budget) => {
      budget.accounts = budget.accounts.filter(
        (account) => account.id !== accountId,
      )
      budget.expenseCategories.forEach((category) => {
        if (category.accountId === accountId) category.accountId = null
      })
      resequence(budget.accounts)
    })
  }

  return (
    <section className="editor-card" aria-labelledby="editor-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Planning</p>
          <h2 id="editor-title">Build your month</h2>
        </div>
        <p className="card-hint">Changes are saved automatically.</p>
      </div>

      <div className="editor-section">
        <div className="section-heading">
          <div>
            <span className="section-number">01</span>
            <h3>Income</h3>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              updateActiveBudget((budget) => {
                budget.incomes.push(
                  createIncome('New income', budget.incomes.length),
                )
              })
            }
          >
            <Plus aria-hidden="true" size={15} />
            Add
          </button>
        </div>
        <div className="editable-list">
          {activeBudget.incomes.map((income, index) => (
            <div className="editable-row" key={income.id}>
              <NameInput
                value={income.name}
                ariaLabel={`Income name ${index + 1}`}
                onCommit={(name) =>
                  updateActiveBudget((budget) => {
                    const target = budget.incomes.find(
                      (candidate) => candidate.id === income.id,
                    )
                    if (target) target.name = name
                  })
                }
              />
              <MoneyInput
                valueCents={income.amountCents}
                ariaLabel={`Amount for ${income.name}`}
                onCommit={(amountCents) =>
                  updateActiveBudget((budget) => {
                    const target = budget.incomes.find(
                      (candidate) => candidate.id === income.id,
                    )
                    if (target) target.amountCents = amountCents
                  })
                }
              />
              <RowActions
                label={income.name}
                index={index}
                count={activeBudget.incomes.length}
                onMove={(direction) =>
                  updateActiveBudget((budget) =>
                    moveItem(budget.incomes, index, direction),
                  )
                }
                onDelete={() =>
                  updateActiveBudget((budget) => {
                    budget.incomes = budget.incomes.filter(
                      (candidate) => candidate.id !== income.id,
                    )
                    resequence(budget.incomes)
                  })
                }
              />
            </div>
          ))}
          {activeBudget.incomes.length === 0 && (
            <p className="empty-row">Add at least one income source.</p>
          )}
        </div>
      </div>

      <div className="editor-section">
        <div className="section-heading">
          <div>
            <span className="section-number">02</span>
            <h3>Accounts and allocations</h3>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              updateActiveBudget((budget) => {
                budget.accounts.push(
                  createAccount('New account', budget.accounts.length),
                )
              })
            }
          >
            <Plus aria-hidden="true" size={15} />
            Add
          </button>
        </div>
        <p className="section-description">
          Set the monthly transfer planned for each account.
        </p>
        <div className="editable-list">
          {activeBudget.accounts.map((account, index) => (
            <div className="editable-row" key={account.id}>
              <NameInput
                value={account.name}
                ariaLabel={`Account name ${index + 1}`}
                onCommit={(name) =>
                  updateActiveBudget((budget) => {
                    const target = budget.accounts.find(
                      (candidate) => candidate.id === account.id,
                    )
                    if (target) target.name = name
                  })
                }
              />
              <MoneyInput
                valueCents={account.plannedTransferCents}
                ariaLabel={`Transfer to ${account.name}`}
                onCommit={(plannedTransferCents) =>
                  updateActiveBudget((budget) => {
                    const target = budget.accounts.find(
                      (candidate) => candidate.id === account.id,
                    )
                    if (target)
                      target.plannedTransferCents = plannedTransferCents
                  })
                }
              />
              <RowActions
                label={account.name}
                index={index}
                count={activeBudget.accounts.length}
                onMove={(direction) =>
                  updateActiveBudget((budget) =>
                    moveItem(budget.accounts, index, direction),
                  )
                }
                onDelete={() => deleteAccount(account.id, account.name)}
              />
            </div>
          ))}
          {activeBudget.accounts.length === 0 && (
            <p className="empty-row">
              Add an account to assign expenses.
            </p>
          )}
        </div>
      </div>

      <div className="editor-section">
        <div className="section-heading">
          <div>
            <span className="section-number">03</span>
            <h3>Expenses</h3>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              updateActiveBudget((budget) => {
                budget.expenseCategories.push(
                  createExpenseCategory(
                    'New category',
                    budget.expenseCategories.length,
                    budget.accounts[0]?.id ?? null,
                  ),
                )
              })
            }
          >
            <Plus aria-hidden="true" size={15} />
            Category
          </button>
        </div>

        <div className="category-list">
          {activeBudget.expenseCategories.map((category, categoryIndex) => (
            <article className="category-card" key={category.id}>
              <div className="category-heading">
                <div className="category-title">
                  <NameInput
                    value={category.name}
                    className="category-name-input"
                    ariaLabel={`Category name ${categoryIndex + 1}`}
                    onCommit={(name) =>
                      updateActiveBudget((budget) => {
                        const target = budget.expenseCategories.find(
                          (candidate) => candidate.id === category.id,
                        )
                        if (target) target.name = name
                      })
                    }
                  />
                  <span>
                    {formatMoney(
                      category.items.reduce(
                        (total, item) => total + item.amountCents,
                        0,
                      ),
                    )}
                  </span>
                </div>
                <select
                  aria-label={`Account for ${category.name}`}
                  value={category.accountId ?? ''}
                  onChange={(event) =>
                    updateActiveBudget((budget) => {
                      const target = budget.expenseCategories.find(
                        (candidate) => candidate.id === category.id,
                      )
                      if (target) target.accountId = event.target.value || null
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {activeBudget.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <RowActions
                  label={category.name}
                  index={categoryIndex}
                  count={activeBudget.expenseCategories.length}
                  onMove={(direction) =>
                    updateActiveBudget((budget) =>
                      moveItem(
                        budget.expenseCategories,
                        categoryIndex,
                        direction,
                      ),
                    )
                  }
                  onDelete={() => {
                    if (
                      window.confirm(
                        `Delete ${category.name} and all its expenses?`,
                      )
                    ) {
                      updateActiveBudget((budget) => {
                        budget.expenseCategories =
                          budget.expenseCategories.filter(
                            (candidate) => candidate.id !== category.id,
                          )
                        resequence(budget.expenseCategories)
                      })
                    }
                  }}
                />
              </div>

              <div className="editable-list expense-items">
                {category.items.map((item, itemIndex) => (
                  <div className="editable-row" key={item.id}>
                    <NameInput
                      value={item.name}
                      ariaLabel={`Expense name ${itemIndex + 1} in ${category.name}`}
                      onCommit={(name) =>
                        updateActiveBudget((budget) => {
                          const targetCategory =
                            budget.expenseCategories.find(
                              (candidate) => candidate.id === category.id,
                            )
                          const target = targetCategory?.items.find(
                            (candidate) => candidate.id === item.id,
                          )
                          if (target) target.name = name
                        })
                      }
                    />
                    <MoneyInput
                      valueCents={item.amountCents}
                      ariaLabel={`Amount for ${item.name}`}
                      onCommit={(amountCents) =>
                        updateActiveBudget((budget) => {
                          const targetCategory =
                            budget.expenseCategories.find(
                              (candidate) => candidate.id === category.id,
                            )
                          const target = targetCategory?.items.find(
                            (candidate) => candidate.id === item.id,
                          )
                          if (target) target.amountCents = amountCents
                        })
                      }
                    />
                    <RowActions
                      label={item.name}
                      index={itemIndex}
                      count={category.items.length}
                      onMove={(direction) =>
                        updateActiveBudget((budget) => {
                          const target = budget.expenseCategories.find(
                            (candidate) => candidate.id === category.id,
                          )
                          if (target)
                            moveItem(target.items, itemIndex, direction)
                        })
                      }
                      onDelete={() =>
                        updateActiveBudget((budget) => {
                          const target = budget.expenseCategories.find(
                            (candidate) => candidate.id === category.id,
                          )
                          if (!target) return
                          target.items = target.items.filter(
                            (candidate) => candidate.id !== item.id,
                          )
                          resequence(target.items)
                        })
                      }
                    />
                  </div>
                ))}
                {category.items.length === 0 && (
                  <p className="empty-row">
                    There are no expenses in this category.
                  </p>
                )}
              </div>
              <button
                type="button"
                className="add-row-button"
                onClick={() =>
                  updateActiveBudget((budget) => {
                    const target = budget.expenseCategories.find(
                      (candidate) => candidate.id === category.id,
                    )
                    if (target)
                      target.items.push(
                        createExpenseItem(
                          'New expense',
                          target.items.length,
                        ),
                      )
                  })
                }
              >
                <Plus aria-hidden="true" size={15} />
                Add expense
              </button>
            </article>
          ))}
          {activeBudget.expenseCategories.length === 0 && (
            <p className="empty-state">
              Create a category to start planning expenses.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
