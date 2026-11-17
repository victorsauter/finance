import { MoneyInput } from '@/components/forms/MoneyInput'
import { NameInput } from '@/components/forms/NameInput'
import { RowMenu } from './RowMenu'
import { DragHandle, SortableRow } from './SortableRow'

interface EditableRowProps {
  id: string
  index: number
  count: number
  name: string
  nameLabel: string
  onNameCommit: (name: string) => void
  amountCents: number
  amountLabel: string
  onAmountCommit: (amountCents: number) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
  /** Focus and select the name when the row mounts (a row just added). */
  autoFocus?: boolean
}

/**
 * One line of a list: [drag handle] [name] [amount] [⋯ menu]. Must be rendered
 * inside a `SortableList`. Inputs stay quiet until hovered or focused.
 */
export function EditableRow({
  id,
  index,
  count,
  name,
  nameLabel,
  onNameCommit,
  amountCents,
  amountLabel,
  onAmountCommit,
  onMove,
  onDelete,
  autoFocus,
}: EditableRowProps) {
  return (
    <SortableRow
      id={id}
      disabled={count < 2}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-1 rounded-lg"
    >
      <DragHandle label={name} />
      <NameInput
        value={name}
        ariaLabel={nameLabel}
        onCommit={onNameCommit}
        autoFocus={autoFocus}
      />
      <MoneyInput
        className="w-24 sm:w-32"
        valueCents={amountCents}
        ariaLabel={amountLabel}
        onCommit={onAmountCommit}
      />
      <RowMenu
        label={name}
        canMoveUp={index > 0}
        canMoveDown={index < count - 1}
        onMove={onMove}
        onDelete={onDelete}
      />
    </SortableRow>
  )
}
