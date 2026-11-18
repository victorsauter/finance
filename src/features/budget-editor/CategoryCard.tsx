import { NameInput } from '@/components/forms/NameInput'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { ExpenseCategory } from '@/domain/budget/models'
import { formatMoney } from '@/domain/budget/money'
import { AddRow } from './AddRow'
import { EditableRow } from './EditableRow'
import { RowMenu } from './RowMenu'
import { SortableList } from './SortableList'
import { DragHandle, SortableRow } from './SortableRow'
import type { BudgetEditorApi, ListRef } from './useBudgetEditor'

interface CategoryCardProps {
  category: ExpenseCategory
  index: number
  count: number
  editor: BudgetEditorApi
}

const categories: ListRef = { kind: 'categories' }

/**
 * One expense category: a single header line (grip, name, subtotal, account,
 * menu) and its expense rows beneath. On narrow cards the account select drops
 * to a second line under the name.
 */
export function CategoryCard({
  category,
  index,
  count,
  editor,
}: CategoryCardProps) {
  const items: ListRef = { kind: 'items', categoryId: category.id }
  const subtotalCents = category.items.reduce(
    (total, item) => total + item.amountCents,
    0,
  )

  return (
    <SortableRow id={category.id} disabled={count < 2} className="@container">
      <Card size="sm" className="gap-2 bg-muted/30 data-[size=sm]:[--card-spacing:--spacing(2)] @md:data-[size=sm]:[--card-spacing:--spacing(3)]">
        <CardHeader className="grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-1 gap-y-2 @md:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]">
          <DragHandle label={category.name} />
          <NameInput
            className="font-medium"
            value={category.name}
            ariaLabel={`Category name ${index + 1}`}
            autoFocus={editor.focusId === category.id}
            onCommit={(name) => editor.rename(categories, category.id, name)}
          />
          <span className="px-1 text-sm text-muted-foreground tabular-nums">
            {formatMoney(subtotalCents)}
          </span>
          <NativeSelect
            wrapperClassName="col-span-3 col-start-2 row-start-2 @md:col-span-1 @md:col-start-4 @md:row-start-1 @md:w-40"
            className="h-9"
            aria-label={`Account for ${category.name}`}
            value={category.accountId ?? ''}
            onChange={(event) =>
              editor.setCategoryAccount(category.id, event.target.value || null)
            }
          >
            <option value="">Unassigned</option>
            {editor.budget.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </NativeSelect>
          <div className="col-start-4 row-start-1 @md:col-start-5">
            <RowMenu
              label={category.name}
              canMoveUp={index > 0}
              canMoveDown={index < count - 1}
              onMove={(direction) => editor.move(categories, index, direction)}
              onDelete={() =>
                editor.remove(categories, category.id, category.name)
              }
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <SortableList
            ids={category.items.map((item) => item.id)}
            labelOf={(id) =>
              category.items.find((item) => item.id === id)?.name ?? 'expense'
            }
            onReorder={(active, over) => editor.reorder(items, active, over)}
          >
            {category.items.map((item, itemIndex) => (
              <EditableRow
                key={item.id}
                id={item.id}
                index={itemIndex}
                count={category.items.length}
                name={item.name}
                nameLabel={`Expense name ${itemIndex + 1} in ${category.name}`}
                amountCents={item.amountCents}
                amountLabel={`Amount for ${item.name}`}
                autoFocus={editor.focusId === item.id}
                onNameCommit={(name) => editor.rename(items, item.id, name)}
                onAmountCommit={(cents) =>
                  editor.setAmount(items, item.id, cents)
                }
                onMove={(direction) => editor.move(items, itemIndex, direction)}
                onDelete={() => editor.remove(items, item.id, item.name)}
              />
            ))}
          </SortableList>
          <AddRow onClick={() => editor.add(items)}>Add expense</AddRow>
        </CardContent>
      </Card>
    </SortableRow>
  )
}
