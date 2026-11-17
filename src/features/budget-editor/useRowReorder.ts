import { useId } from 'react'
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DndContextProps,
  type Modifier,
  type ScreenReaderInstructions,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

/** Keeps a dragged row on its vertical track. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})

const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    'To reorder, press space to pick up the row, use the up and down arrow keys to move it, then press space to drop it or escape to cancel.',
}

interface UseRowReorderOptions {
  /** Row ids in display order. */
  ids: string[]
  /** Human name of a row, used in screen reader announcements. */
  labelOf: (id: string) => string
  /** Called once when a row is dropped on another row's position. */
  onReorder: (activeId: string, overId: string) => void
}

/**
 * Sensors (mouse, touch, keyboard), announcements and drop handling shared by
 * every sortable list of the editor. Spread the result on a `DndContext`.
 */
export function useRowReorder({
  ids,
  labelOf,
  onReorder,
}: UseRowReorderOptions): DndContextProps {
  const id = useId()
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const position = (rowId: string | number) =>
    `position ${ids.indexOf(String(rowId)) + 1} of ${ids.length}`

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${labelOf(String(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${labelOf(String(active.id))} is over ${position(over.id)}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${labelOf(String(active.id))} dropped at ${position(over.id)}.`
        : `${labelOf(String(active.id))} dropped. Order unchanged.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. ${labelOf(String(active.id))} did not move.`,
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id))
    }
  }

  return {
    id,
    sensors,
    collisionDetection: closestCenter,
    modifiers: [restrictToVerticalAxis],
    accessibility: { announcements, screenReaderInstructions },
    onDragEnd,
  }
}
