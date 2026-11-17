import { useId, type ReactNode } from 'react'
import { Section } from '@/components/layout/Section'
import { formatMoney } from '@/domain/budget/money'
import { AddRow } from './AddRow'
import { CategoryCard } from './CategoryCard'
import { EditableRow } from './EditableRow'
import { SortableList } from './SortableList'
import { useBudgetEditor, type ListRef } from './useBudgetEditor'

const incomes: ListRef = { kind: 'incomes' }
const accounts: ListRef = { kind: 'accounts' }
const categories: ListRef = { kind: 'categories' }

function EditorGroup({
  title,
  totalCents,
  children,
}: {
  title: string
  totalCents: number
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 id={titleId} className="text-sm font-medium">
          {title}
        </h3>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatMoney(totalCents)}
        </span>
      </div>
      {children}
    </section>
  )
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

export function BudgetEditor() {
  const editor = useBudgetEditor()
  const { budget, focusId } = editor

  return (
    <Section
      title="Build your month"
      className="[--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(5)]"
      contentClassName="flex flex-col gap-6"
    >
      <EditorGroup
        title="Income"
        totalCents={sum(budget.incomes.map((income) => income.amountCents))}
      >
        <SortableList
          ids={budget.incomes.map((income) => income.id)}
          labelOf={(id) =>
            budget.incomes.find((income) => income.id === id)?.name ?? 'income'
          }
          onReorder={(active, over) => editor.reorder(incomes, active, over)}
        >
          {budget.incomes.map((income, index) => (
            <EditableRow
              key={income.id}
              id={income.id}
              index={index}
              count={budget.incomes.length}
              name={income.name}
              nameLabel={`Income name ${index + 1}`}
              amountCents={income.amountCents}
              amountLabel={`Amount for ${income.name}`}
              autoFocus={focusId === income.id}
              onNameCommit={(name) => editor.rename(incomes, income.id, name)}
              onAmountCommit={(cents) =>
                editor.setAmount(incomes, income.id, cents)
              }
              onMove={(direction) => editor.move(incomes, index, direction)}
              onDelete={() => editor.remove(incomes, income.id, income.name)}
            />
          ))}
        </SortableList>
        <AddRow onClick={() => editor.add(incomes)}>Add income</AddRow>
      </EditorGroup>

      <EditorGroup
        title="Accounts"
        totalCents={sum(
          budget.accounts.map((account) => account.plannedTransferCents),
        )}
      >
        <SortableList
          ids={budget.accounts.map((account) => account.id)}
          labelOf={(id) =>
            budget.accounts.find((account) => account.id === id)?.name ??
            'account'
          }
          onReorder={(active, over) => editor.reorder(accounts, active, over)}
        >
          {budget.accounts.map((account, index) => (
            <EditableRow
              key={account.id}
              id={account.id}
              index={index}
              count={budget.accounts.length}
              name={account.name}
              nameLabel={`Account name ${index + 1}`}
              amountCents={account.plannedTransferCents}
              amountLabel={`Transfer to ${account.name}`}
              autoFocus={focusId === account.id}
              onNameCommit={(name) => editor.rename(accounts, account.id, name)}
              onAmountCommit={(cents) =>
                editor.setAmount(accounts, account.id, cents)
              }
              onMove={(direction) => editor.move(accounts, index, direction)}
              onDelete={() =>
                editor.remove(accounts, account.id, account.name)
              }
            />
          ))}
        </SortableList>
        <AddRow onClick={() => editor.add(accounts)}>Add account</AddRow>
      </EditorGroup>

      <EditorGroup
        title="Expenses"
        totalCents={sum(
          budget.expenseCategories.flatMap((category) =>
            category.items.map((item) => item.amountCents),
          ),
        )}
      >
        <SortableList
          ids={budget.expenseCategories.map((category) => category.id)}
          labelOf={(id) =>
            budget.expenseCategories.find((category) => category.id === id)
              ?.name ?? 'category'
          }
          onReorder={(active, over) => editor.reorder(categories, active, over)}
          className="gap-3"
        >
          {budget.expenseCategories.map((category, index) => (
            <CategoryCard
              key={category.id}
              category={category}
              index={index}
              count={budget.expenseCategories.length}
              editor={editor}
            />
          ))}
        </SortableList>
        <AddRow onClick={() => editor.add(categories)}>Add category</AddRow>
      </EditorGroup>
    </Section>
  )
}
