import { createContext, useContext, useMemo, useState } from 'react'
import {
  createColumnHelper,
  rowSortingFeature,
  createSortedRowModel,
  sortFn_basic,
  tableFeatures,
  useTable,
  type SortingState,
} from '@tanstack/react-table'
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  Trash2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import type {
  BudgetMonth,
  ImportedTransaction,
  ImportedTransactionKind,
} from '@/domain/budget/models'
import {
  formatTransactionAmount,
  formatTransactionDate,
} from '@/domain/transactions/format'
import { cn } from '@/lib/utils'

const kindLabels: Record<ImportedTransactionKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}
const kinds = Object.keys(kindLabels) as ImportedTransactionKind[]

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
})
const columnHelper = createColumnHelper<typeof features, ImportedTransaction>()

const defaultSorting: SortingState = [{ id: 'date', desc: true }]

/**
 * Layout per column. Below the `@3xl` container width a row is a small grid
 * (date and amount, description, type, category, delete); from `@3xl` it is a
 * regular table row.
 */
const cellClass = {
  date: 'col-start-1 row-start-1 text-xs text-muted-foreground @3xl:w-24 @3xl:text-sm',
  amount:
    'col-span-2 col-start-2 row-start-1 text-right text-sm font-medium tabular-nums @3xl:w-32',
  description: 'col-span-2 col-start-1 row-start-2 min-w-0 @3xl:min-w-48',
  kind: 'col-start-1 row-start-3 @3xl:w-36',
  category: 'col-span-2 col-start-2 row-start-3 @3xl:w-56',
  actions:
    'col-start-3 row-start-2 flex justify-end @3xl:w-14 @3xl:text-right',
} as const
type ColumnId = keyof typeof cellClass

const headerClass: Record<ColumnId, string> = {
  date: 'text-left',
  description: 'text-left',
  kind: 'text-left',
  category: 'text-left',
  amount: 'text-right',
  actions: '',
}

interface TransactionsTableProps {
  transactions: ImportedTransaction[]
  budget: BudgetMonth | undefined
  onCategoryChange: (transactionId: string, categoryId: string | null) => void
  onKindChange: (
    transactionId: string,
    kind: ImportedTransactionKind,
  ) => void
  onDelete: (transaction: ImportedTransaction) => void
}

function FieldLabel({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      className="mb-1 block text-xs text-muted-foreground @3xl:hidden"
    >
      {children}
    </span>
  )
}

interface TableActions {
  budget: BudgetMonth | undefined
  onCategoryChange: TransactionsTableProps['onCategoryChange']
  onKindChange: TransactionsTableProps['onKindChange']
  onDelete: TransactionsTableProps['onDelete']
}

// Cell components read the budget and handlers from context so the column
// definitions below stay module-level constants: TanStack Table renders cell
// functions as components, and a new function identity would remount every
// select (and drop its focus) on each render.
const ActionsContext = createContext<TableActions | null>(null)

function useActions() {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error('Missing TransactionsTable context.')
  return actions
}

function DescriptionCell({ transaction }: { transaction: ImportedTransaction }) {
  return (
    <>
      <p className="font-medium break-words">{transaction.description}</p>
      <p className="text-xs break-words text-muted-foreground">
        {transaction.transactionType ?? 'Unknown type'}
        {transaction.feeCents > 0
          ? ` · fee ${formatTransactionAmount(
              transaction.feeCents,
              transaction.currency,
            )}`
          : ''}
      </p>
    </>
  )
}

function KindCell({ transaction }: { transaction: ImportedTransaction }) {
  const { onKindChange } = useActions()
  return (
    <>
      <FieldLabel>Type</FieldLabel>
      <NativeSelect
        className="@3xl:h-9"
        aria-label={`Type for ${transaction.description}`}
        value={transaction.kind}
        onChange={(event) =>
          onKindChange(
            transaction.id,
            event.target.value as ImportedTransactionKind,
          )
        }
      >
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {kindLabels[kind]}
          </option>
        ))}
      </NativeSelect>
    </>
  )
}

function CategoryCell({ transaction }: { transaction: ImportedTransaction }) {
  const { budget, onCategoryChange } = useActions()
  const canCategorize =
    transaction.kind === 'expense' && Boolean(budget?.expenseCategories.length)
  return (
    <>
      <FieldLabel>Category</FieldLabel>
      <NativeSelect
        className="@3xl:h-9"
        aria-label={`Category for ${transaction.description}`}
        value={canCategorize ? (transaction.categoryId ?? '') : ''}
        disabled={!canCategorize}
        onChange={(event) =>
          onCategoryChange(transaction.id, event.target.value || null)
        }
      >
        <option value="">
          {transaction.kind !== 'expense'
            ? 'Not applicable'
            : budget
              ? 'To classify'
              : 'No budget'}
        </option>
        {budget?.expenseCategories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </NativeSelect>
    </>
  )
}

function DeleteCell({ transaction }: { transaction: ImportedTransaction }) {
  const { onDelete } = useActions()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 @3xl:size-9"
      aria-label={`Delete ${transaction.description}`}
      onClick={() => onDelete(transaction)}
    >
      <Trash2Icon aria-hidden="true" />
    </Button>
  )
}

const columns = columnHelper.columns([
  columnHelper.accessor('bookingDate', {
    id: 'date',
    header: 'Date',
    sortFn: sortFn_basic,
    sortDescFirst: true,
    cell: ({ row }) => (
      <time dateTime={row.original.bookingDate}>
        {formatTransactionDate(row.original.bookingDate)}
      </time>
    ),
  }),
  columnHelper.accessor('description', {
    header: 'Description',
    enableSorting: false,
    cell: ({ row }) => <DescriptionCell transaction={row.original} />,
  }),
  columnHelper.accessor('kind', {
    header: 'Type',
    enableSorting: false,
    cell: ({ row }) => <KindCell transaction={row.original} />,
  }),
  columnHelper.accessor('categoryId', {
    id: 'category',
    header: 'Category',
    enableSorting: false,
    cell: ({ row }) => <CategoryCell transaction={row.original} />,
  }),
  columnHelper.accessor('amountCents', {
    id: 'amount',
    header: 'Amount',
    enableSorting: false,
    cell: ({ row }) => (
      <span className={cn(row.original.amountCents > 0 && 'text-success')}>
        {formatTransactionAmount(
          row.original.amountCents,
          row.original.currency,
        )}
      </span>
    ),
  }),
  columnHelper.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <DeleteCell transaction={row.original} />,
  }),
])

export function TransactionsTable({
  transactions,
  budget,
  onCategoryChange,
  onKindChange,
  onDelete,
}: TransactionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting)
  const actions = useMemo(
    () => ({ budget, onCategoryChange, onKindChange, onDelete }),
    [budget, onCategoryChange, onKindChange, onDelete],
  )

  // Stable tie-break: rows with the same date keep the description order,
  // because the sorted row model falls back to the original index.
  const data = useMemo(
    () =>
      [...transactions].sort((left, right) =>
        left.description.localeCompare(right.description, 'en'),
      ),
    [transactions],
  )

  const table = useTable({
    features,
    columns,
    data,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.id,
  })

  const dateColumn = table.getColumn('date')
  const dateDirection = dateColumn?.getIsSorted() || 'desc'
  const SortIcon =
    dateDirection === 'asc'
      ? ArrowUpIcon
      : dateDirection === 'desc'
        ? ArrowDownIcon
        : ArrowUpDownIcon
  const sortLabel = dateDirection === 'asc' ? 'Oldest first' : 'Newest first'

  return (
    <ActionsContext value={actions}>
      <div className="@container space-y-3">
        <div className="flex @3xl:hidden">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => dateColumn?.toggleSorting()}
          >
            <SortIcon aria-hidden="true" />
            Sort by date: {sortLabel}
          </Button>
        </div>
        <table className="block w-full text-sm @3xl:table">
          <thead className="hidden @3xl:table-header-group">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b">
                {group.headers.map((header) => {
                  const id = header.column.id as ColumnId
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className={cn(
                        'px-2 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground',
                        headerClass[id],
                      )}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-1 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                          onClick={() => header.column.toggleSorting()}
                        >
                          <table.FlexRender header={header} />
                          <SortIcon aria-hidden="true" className="size-3.5" />
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody className="block @3xl:table-row-group">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="grid grid-cols-[1fr_1fr_auto] items-start gap-x-3 gap-y-2 border-b py-3 last:border-b-0 @3xl:table-row"
              >
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      'align-middle @3xl:table-cell @3xl:p-2',
                      cellClass[cell.column.id as ColumnId],
                      cell.column.id === 'amount' && '@3xl:text-right',
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ActionsContext>
  )
}
