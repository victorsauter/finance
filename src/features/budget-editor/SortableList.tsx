import type { ReactNode } from 'react'
import { DndContext } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import { useRowReorder } from './useRowReorder'

interface SortableListProps {
  ids: string[]
  labelOf: (id: string) => string
  onReorder: (activeId: string, overId: string) => void
  /** Classes of the list wrapper; defaults to a tight vertical stack. */
  className?: string
  children: ReactNode
}

/** A vertical drag-and-drop list: wrap `SortableRow`s (one per id) in it. */
export function SortableList({
  ids,
  labelOf,
  onReorder,
  className,
  children,
}: SortableListProps) {
  const dnd = useRowReorder({ ids, labelOf, onReorder })
  return (
    <DndContext {...dnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={cn('flex flex-col gap-1', className)}>{children}</div>
      </SortableContext>
    </DndContext>
  )
}
