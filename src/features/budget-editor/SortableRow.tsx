import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SortableRowContext, useSortableRow } from './sortable-context'

interface SortableRowProps {
  id: string
  /** Disable dragging, e.g. when the list has a single row. */
  disabled?: boolean
  className?: string
  children: ReactNode
}

/** A draggable row. Render a `DragHandle` inside to let people grab it. */
export function SortableRow({
  id,
  disabled = false,
  className,
  children,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  return (
    <SortableRowContext
      value={{ attributes, listeners, setActivatorNodeRef, isDragging, disabled }}
    >
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        data-dragging={isDragging || undefined}
        className={cn(
          'data-dragging:relative data-dragging:z-10 data-dragging:rounded-lg data-dragging:bg-card data-dragging:shadow-lg data-dragging:ring-1 data-dragging:ring-foreground/10',
          className,
        )}
      >
        {children}
      </div>
    </SortableRowContext>
  )
}

/** The grip button of a `SortableRow`: pointer, touch and keyboard (space). */
export function DragHandle({ label }: { label: string }) {
  const { attributes, listeners, setActivatorNodeRef, isDragging, disabled } =
    useSortableRow()
  return (
    <button
      ref={setActivatorNodeRef}
      type="button"
      disabled={disabled}
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${label}`}
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
        'touch-none text-muted-foreground',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      <GripVertical aria-hidden="true" />
    </button>
  )
}
