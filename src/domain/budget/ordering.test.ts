import { describe, expect, it } from 'vitest'
import {
  insertAt,
  moveItem,
  removeById,
  reorder,
  reorderById,
  resequence,
} from './ordering'

function list(...ids: string[]) {
  return ids.map((id, index) => ({ id, sortOrder: index }))
}

function ids(items: { id: string }[]) {
  return items.map((item) => item.id).join('')
}

function orders(items: { sortOrder: number }[]) {
  return items.map((item) => item.sortOrder)
}

describe('resequence', () => {
  it('rewrites sortOrder from the array order', () => {
    const items = [
      { id: 'a', sortOrder: 7 },
      { id: 'b', sortOrder: 7 },
      { id: 'c', sortOrder: 0 },
    ]
    resequence(items)
    expect(orders(items)).toEqual([0, 1, 2])
  })

  it('accepts an empty list', () => {
    expect(() => resequence([])).not.toThrow()
  })
})

describe('reorder', () => {
  it('moves an item forward and backward and rewrites sortOrder', () => {
    const items = list('a', 'b', 'c', 'd')
    reorder(items, 0, 2)
    expect(ids(items)).toBe('bcad')
    expect(orders(items)).toEqual([0, 1, 2, 3])

    reorder(items, 3, 0)
    expect(ids(items)).toBe('dbca')
    expect(orders(items)).toEqual([0, 1, 2, 3])
  })

  it('ignores identical, negative and out-of-range indexes', () => {
    const items = list('a', 'b', 'c')
    items[0]!.sortOrder = 5
    reorder(items, 1, 1)
    reorder(items, -1, 1)
    reorder(items, 1, -1)
    reorder(items, 3, 0)
    reorder(items, 0, 3)
    expect(ids(items)).toBe('abc')
    // Untouched: no resequence happens on a no-op.
    expect(items[0]!.sortOrder).toBe(5)
  })

  it('handles empty and single-item lists', () => {
    const empty: { sortOrder: number }[] = []
    reorder(empty, 0, 0)
    expect(empty).toEqual([])
    const single = list('a')
    reorder(single, 0, 0)
    expect(ids(single)).toBe('a')
  })
})

describe('moveItem', () => {
  it('moves one step up and down', () => {
    const items = list('a', 'b', 'c')
    moveItem(items, 1, -1)
    expect(ids(items)).toBe('bac')
    moveItem(items, 1, 1)
    expect(ids(items)).toBe('bca')
    expect(orders(items)).toEqual([0, 1, 2])
  })

  it('does nothing past either end', () => {
    const items = list('a', 'b')
    moveItem(items, 0, -1)
    moveItem(items, 1, 1)
    expect(ids(items)).toBe('ab')
  })
})

describe('reorderById', () => {
  it('moves the active item to the position of the over item', () => {
    const items = list('a', 'b', 'c')
    reorderById(items, 'a', 'c')
    expect(ids(items)).toBe('bca')
    expect(orders(items)).toEqual([0, 1, 2])
  })

  it('ignores unknown ids and identical ids', () => {
    const items = list('a', 'b', 'c')
    reorderById(items, 'a', 'zzz')
    reorderById(items, 'zzz', 'a')
    reorderById(items, 'b', 'b')
    expect(ids(items)).toBe('abc')
  })
})

describe('removeById and insertAt', () => {
  it('removes an item, resequences and reports where it was', () => {
    const items = list('a', 'b', 'c')
    const removed = removeById(items, 'b')
    expect(removed).toEqual({ item: { id: 'b', sortOrder: 1 }, index: 1 })
    expect(ids(items)).toBe('ac')
    expect(orders(items)).toEqual([0, 1])
  })

  it('returns null for an unknown id', () => {
    const items = list('a')
    expect(removeById(items, 'x')).toBeNull()
    expect(ids(items)).toBe('a')
  })

  it('restores a removed item at its old index', () => {
    const items = list('a', 'b', 'c')
    const removed = removeById(items, 'b')!
    insertAt(items, removed.item, removed.index)
    expect(ids(items)).toBe('abc')
    expect(orders(items)).toEqual([0, 1, 2])
  })

  it('clamps the insert position', () => {
    const items = list('a', 'b')
    insertAt(items, { id: 'x', sortOrder: 0 }, 99)
    insertAt(items, { id: 'y', sortOrder: 0 }, -4)
    expect(ids(items)).toBe('yabx')
    expect(orders(items)).toEqual([0, 1, 2, 3])
  })
})
