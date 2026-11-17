/**
 * In-place helpers for the ordered lists of a budget month (incomes, accounts,
 * categories, expense items). Every list is kept in array order and each item's
 * `sortOrder` mirrors its index. They mutate the list, so call them inside the
 * `updateActiveBudget` draft.
 */

export interface Ordered {
  sortOrder: number
}

export interface Identified {
  id: string
}

/** Rewrites `sortOrder` so it equals each item's index. */
export function resequence<T extends Ordered>(items: T[]) {
  items.forEach((item, index) => {
    item.sortOrder = index
  })
}

/** Moves the item at `from` to position `to`. Out-of-range or no-op calls do nothing. */
export function reorder<T extends Ordered>(
  items: T[],
  from: number,
  to: number,
) {
  if (from === to) return
  if (from < 0 || from >= items.length) return
  if (to < 0 || to >= items.length) return
  const [item] = items.splice(from, 1)
  if (!item) return
  items.splice(to, 0, item)
  resequence(items)
}

/** Moves the item at `index` one step up (-1) or down (+1). */
export function moveItem<T extends Ordered>(
  items: T[],
  index: number,
  direction: -1 | 1,
) {
  reorder(items, index, index + direction)
}

/** Moves the item `activeId` to where `overId` currently sits (drag and drop). */
export function reorderById<T extends Ordered & Identified>(
  items: T[],
  activeId: string,
  overId: string,
) {
  reorder(
    items,
    items.findIndex((item) => item.id === activeId),
    items.findIndex((item) => item.id === overId),
  )
}

/**
 * Removes the item with `id` and resequences. Returns what was removed and
 * where, so the caller can offer an undo, or null when the id is unknown.
 */
export function removeById<T extends Ordered & Identified>(
  items: T[],
  id: string,
): { item: T; index: number } | null {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return null
  const [item] = items.splice(index, 1)
  if (!item) return null
  resequence(items)
  return { item, index }
}

/** Inserts `item` at `index` (clamped to the list) and resequences. */
export function insertAt<T extends Ordered>(
  items: T[],
  item: T,
  index: number,
) {
  const position = Math.min(Math.max(index, 0), items.length)
  items.splice(position, 0, item)
  resequence(items)
}
