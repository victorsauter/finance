import { useMemo, useRef } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { useBudget } from '../../app/budget-context'
import { NameInput } from '../../components/forms/NameInput'

export function MonthToolbar() {
  const actionsRef = useRef<HTMLDetailsElement>(null)
  const {
    data,
    activeBudget,
    setActiveBudget,
    goToAdjacentBudget,
    createFollowingBudget,
    deleteActiveBudget,
    updateActiveBudget,
  } = useBudget()

  const sortedBudgets = useMemo(
    () =>
      [...data.budgetMonths].sort(
        (left, right) =>
          left.year * 12 + left.month - (right.year * 12 + right.month),
      ),
    [data.budgetMonths],
  )
  const activeIndex = sortedBudgets.findIndex(
    (budget) => budget.id === activeBudget.id,
  )

  const handleDelete = () => {
    if (data.budgetMonths.length <= 1) {
      window.alert('The last budget cannot be deleted.')
      return
    }
    if (
      window.confirm(
        `Delete ${activeBudget.name} and all of its planned data?`,
      )
    ) {
      deleteActiveBudget()
    }
    if (actionsRef.current) actionsRef.current.open = false
  }

  const createMonth = (copyCurrent: boolean) => {
    createFollowingBudget(copyCurrent)
    if (actionsRef.current) actionsRef.current.open = false
  }

  return (
    <section className="month-toolbar" aria-label="Month navigation">
      <div className="month-heading">
        <p className="eyebrow">Monthly budget</p>
        <NameInput
          value={activeBudget.name}
          ariaLabel="Budget name"
          className="month-name-input"
          onCommit={(name) =>
            updateActiveBudget((budget) => {
              budget.name = name
            })
          }
        />
      </div>

      <div className="month-navigation">
        <button
          type="button"
          className="icon-button"
          disabled={activeIndex <= 0}
          aria-label="Previous budget"
          onClick={() => goToAdjacentBudget(-1)}
        >
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
        <select
          aria-label="Active budget"
          value={activeBudget.id}
          onChange={(event) => setActiveBudget(event.target.value)}
        >
          {sortedBudgets.map((budget) => (
            <option key={budget.id} value={budget.id}>
              {budget.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          disabled={activeIndex >= sortedBudgets.length - 1}
          aria-label="Next budget"
          onClick={() => goToAdjacentBudget(1)}
        >
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      </div>

      <div className="month-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => createMonth(false)}
        >
          <Plus aria-hidden="true" size={17} />
          New month
        </button>
        <details ref={actionsRef} className="month-more">
          <summary className="icon-button" aria-label="Budget actions">
            <MoreHorizontal aria-hidden="true" size={21} />
            <span className="visually-hidden">Budget actions</span>
          </summary>
          <div className="month-actions-menu glass-panel">
            <button type="button" onClick={() => createMonth(true)}>
              <CopyPlus aria-hidden="true" size={17} />
              Copy this month
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={handleDelete}
            >
              <Trash2 aria-hidden="true" size={17} />
              Delete budget
            </button>
          </div>
        </details>
      </div>
    </section>
  )
}
