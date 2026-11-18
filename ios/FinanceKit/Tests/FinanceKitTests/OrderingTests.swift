import Foundation
import Testing
@testable import FinanceKit

@Suite struct OrderingTests {
    private func incomes(_ names: String...) -> [Income] {
        names.enumerated().map { index, name in
            Income(id: name, name: name, amountCents: 0, sortOrder: index)
        }
    }

    private func names(_ items: [Income]) -> [String] { items.map(\.name) }
    private func isContiguous(_ items: [Income]) -> Bool {
        items.enumerated().allSatisfy { $0.offset == $0.element.sortOrder }
    }

    @Test func resequenceWritesIndexes() {
        var items = incomes("a", "b", "c")
        items[0].sortOrder = 9
        items[2].sortOrder = 4
        resequence(&items)
        #expect(isContiguous(items))
    }

    @Test func reorderMovesOneItem() {
        var items = incomes("a", "b", "c", "d")
        reorder(&items, from: 0, to: 2)
        #expect(names(items) == ["b", "c", "a", "d"])
        #expect(isContiguous(items))
    }

    @Test(arguments: [(1, 1), (-1, 0), (0, 4), (4, 0), (0, -1)])
    func reorderIgnoresNoOpsAndOutOfRange(_ from: Int, _ to: Int) {
        var items = incomes("a", "b", "c", "d")
        reorder(&items, from: from, to: to)
        #expect(names(items) == ["a", "b", "c", "d"])
    }

    @Test func moveItemStepsUpAndDown() {
        var items = incomes("a", "b", "c")
        moveItem(&items, at: 1, direction: -1)
        #expect(names(items) == ["b", "a", "c"])
        moveItem(&items, at: 0, direction: -1)
        #expect(names(items) == ["b", "a", "c"])
        moveItem(&items, at: 2, direction: 1)
        #expect(names(items) == ["b", "a", "c"])
    }

    @Test func onMoveFollowsTheSwiftUIContract() {
        var down = incomes("a", "b", "c", "d")
        move(&down, fromOffsets: IndexSet(integer: 0), toOffset: 3)
        #expect(names(down) == ["b", "c", "a", "d"])

        var up = incomes("a", "b", "c", "d")
        move(&up, fromOffsets: IndexSet(integer: 3), toOffset: 1)
        #expect(names(up) == ["a", "d", "b", "c"])

        var toEnd = incomes("a", "b", "c")
        move(&toEnd, fromOffsets: IndexSet(integer: 0), toOffset: 3)
        #expect(names(toEnd) == ["b", "c", "a"])

        var toStart = incomes("a", "b", "c")
        move(&toStart, fromOffsets: IndexSet(integer: 2), toOffset: 0)
        #expect(names(toStart) == ["c", "a", "b"])
        #expect(isContiguous(toStart))
    }

    @Test func onMoveHandlesSeveralItemsAndBadInput() {
        var items = incomes("a", "b", "c", "d")
        move(&items, fromOffsets: IndexSet([0, 1]), toOffset: 4)
        #expect(names(items) == ["c", "d", "a", "b"])

        var unchanged = incomes("a", "b")
        move(&unchanged, fromOffsets: IndexSet(integer: 5), toOffset: 0)
        move(&unchanged, fromOffsets: IndexSet(integer: 0), toOffset: 9)
        #expect(names(unchanged) == ["a", "b"])
    }

    @Test func removeByIdReturnsTheItemAndItsPlace() throws {
        var items = incomes("a", "b", "c")
        let result = removeById(&items, id: "b")
        let removed = try #require(result)
        #expect(removed.item.name == "b")
        #expect(removed.index == 1)
        #expect(names(items) == ["a", "c"])
        #expect(isContiguous(items))
        let missing = removeById(&items, id: "zzz")
        #expect(missing == nil)
    }

    @Test func insertAtClampsTheIndex() {
        var items = incomes("a", "b")
        insertAt(&items, Income(id: "x", name: "x", amountCents: 0, sortOrder: 7), at: 99)
        insertAt(&items, Income(id: "y", name: "y", amountCents: 0, sortOrder: 7), at: -3)
        #expect(names(items) == ["y", "a", "b", "x"])
        #expect(isContiguous(items))
    }
}
