import { createContext, useContext } from 'react'
import type { DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'

export interface SortableRowContextValue {
  attributes: DraggableAttributes
  listeners: SyntheticListenerMap | undefined
  setActivatorNodeRef: (element: HTMLElement | null) => void
  isDragging: boolean
  disabled: boolean
}

export const SortableRowContext = createContext<SortableRowContextValue | null>(
  null,
)

export function useSortableRow(): SortableRowContextValue {
  const context = useContext(SortableRowContext)
  if (!context) {
    throw new Error('DragHandle must be rendered inside a SortableRow.')
  }
  return context
}
