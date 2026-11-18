import Foundation

// Port of `src/domain/budget/ordering.ts`: in-place helpers for the ordered
// lists of a budget month. Every list is kept in array order and each item's
// `sortOrder` equals its index.

public protocol Ordered {
    var sortOrder: Int { get set }
}

extension Income: Ordered {}
extension Account: Ordered {}
extension ExpenseItem: Ordered {}
extension ExpenseCategory: Ordered {}

/// Rewrites `sortOrder` so it equals each item's index.
public func resequence<T: Ordered>(_ items: inout [T]) {
    for index in items.indices {
        items[index].sortOrder = index
    }
}

/// Moves the item at `from` to position `to`. Out-of-range or no-op calls do
/// nothing.
public func reorder<T: Ordered>(_ items: inout [T], from: Int, to: Int) {
    guard from != to, items.indices.contains(from), items.indices.contains(to) else { return }
    let item = items.remove(at: from)
    items.insert(item, at: to)
    resequence(&items)
}

/// Moves the item at `index` one step up (-1) or down (+1).
public func moveItem<T: Ordered>(_ items: inout [T], at index: Int, direction: Int) {
    reorder(&items, from: index, to: index + direction)
}

/// SwiftUI's `onMove` contract: the items at `offsets` end up just before the
/// element that sits at `destination` in the original array.
public func move<T: Ordered>(_ items: inout [T], fromOffsets offsets: IndexSet, toOffset destination: Int) {
    let valid = offsets.filter { items.indices.contains($0) }
    guard !valid.isEmpty, destination >= 0, destination <= items.count else { return }
    let moving = valid.map { items[$0] }
    let before = valid.filter { $0 < destination }.count
    var rest = items
    for index in valid.reversed() { rest.remove(at: index) }
    rest.insert(contentsOf: moving, at: destination - before)
    items = rest
    resequence(&items)
}

/// Removes the item with `id` and resequences. Returns what was removed and
/// where, so the caller can offer an undo, or nil when the id is unknown.
public func removeById<T: Ordered & Identifiable>(
    _ items: inout [T], id: T.ID
) -> (item: T, index: Int)? {
    guard let index = items.firstIndex(where: { $0.id == id }) else { return nil }
    let item = items.remove(at: index)
    resequence(&items)
    return (item, index)
}

/// Inserts `item` at `index` (clamped to the list) and resequences.
public func insertAt<T: Ordered>(_ items: inout [T], _ item: T, at index: Int) {
    items.insert(item, at: min(max(index, 0), items.count))
    resequence(&items)
}
