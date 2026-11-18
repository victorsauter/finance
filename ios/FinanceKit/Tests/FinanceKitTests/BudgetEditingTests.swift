import Foundation
import Testing
@testable import FinanceKit

@Suite struct BudgetEditingTests {
    private func month() -> BudgetMonth {
        var budget = createEmptyBudgetMonth(year: 2026, month: 11)
        budget.addIncome(name: "Bonus", amountCents: 450_00)
        budget.addAccount(name: "Savings", plannedTransferCents: 300_00)
        return budget
    }

    private func contiguous<T: Ordered>(_ items: [T]) -> Bool {
        items.enumerated().allSatisfy { $0.offset == $0.element.sortOrder }
    }

    @Test func addsRowsAtTheEndWithTrimmedNames() throws {
        var budget = month()
        let incomeIdResult = budget.addIncome(name: "  Gift  ", amountCents: 50_00)
        let incomeId = try #require(incomeIdResult)
        #expect(budget.incomes.last?.name == "Gift")
        #expect(budget.incomes.last?.amountCents == 50_00)
        #expect(budget.incomes.last?.id == incomeId)
        #expect(contiguous(budget.incomes))
        #expect(budget.accounts.count == 2)
    }

    @Test func blankNamesAreRejected() {
        var budget = month()
        #expect(budget.addIncome(name: "   ", amountCents: 1) == nil)
        #expect(budget.addAccount(name: "", plannedTransferCents: 1) == nil)
        #expect(budget.addCategory(name: "\n", accountId: nil) == nil)
        #expect(budget.incomes.count == 2)
        let before = budget
        let id = budget.incomes[0].id
        budget.rename(.incomes, id: id, to: "  ")
        #expect(budget == before)
    }

    @Test func newCategoryIsEmptyAndKeepsAKnownAccount() throws {
        var budget = month()
        let savings = budget.accounts[1].id
        let idResult = budget.addCategory(name: "Gifts", accountId: savings)
        let id = try #require(idResult)
        let category = try #require(budget.expenseCategories.first { $0.id == id })
        #expect(category.items.isEmpty)
        #expect(category.accountId == savings)
        #expect(category.sortOrder == budget.expenseCategories.count - 1)

        let orphanResult = budget.addCategory(name: "Odd", accountId: "no-such-account")
        let orphan = try #require(orphanResult)
        #expect(budget.expenseCategories.first { $0.id == orphan }?.accountId == nil)
    }

    @Test func addsItemsToACategory() throws {
        var budget = month()
        let category = budget.expenseCategories[0].id
        let count = budget.expenseCategories[0].items.count
        let idResult = budget.addItem(name: "Water", amountCents: 20_00, toCategory: category)
        let id = try #require(idResult)
        #expect(budget.expenseCategories[0].items.count == count + 1)
        #expect(budget.expenseCategories[0].items.last?.id == id)
        #expect(contiguous(budget.expenseCategories[0].items))
        #expect(budget.addItem(name: "Lost", amountCents: 1, toCategory: "nope") == nil)
    }

    @Test func renamesAndSetsAmountsInEveryList() throws {
        var budget = month()
        let income = budget.incomes[1].id
        let account = budget.accounts[1].id
        let category = budget.expenseCategories[0].id
        let item = budget.expenseCategories[0].items[0].id

        budget.rename(.incomes, id: income, to: "Prize")
        budget.rename(.accounts, id: account, to: "Rainy day")
        budget.rename(.categories, id: category, to: "Home")
        budget.rename(.items(categoryId: category), id: item, to: "Rent")
        budget.setAmount(.incomes, id: income, cents: 1)
        budget.setAmount(.accounts, id: account, cents: 2)
        budget.setAmount(.items(categoryId: category), id: item, cents: 3)
        budget.setAmount(.categories, id: category, cents: 99)

        #expect(budget.incomes[1].name == "Prize" && budget.incomes[1].amountCents == 1)
        #expect(budget.accounts[1].name == "Rainy day" && budget.accounts[1].plannedTransferCents == 2)
        #expect(budget.expenseCategories[0].name == "Home")
        #expect(budget.expenseCategories[0].items[0].name == "Rent")
        #expect(budget.expenseCategories[0].items[0].amountCents == 3)
        #expect(budget.expenseCategories[0].totalCents == 3)
    }

    @Test func negativeAmountsAreIgnored() {
        var budget = month()
        let id = budget.incomes[0].id
        budget.setAmount(.incomes, id: id, cents: 10)
        budget.setAmount(.incomes, id: id, cents: -5)
        #expect(budget.incomes[0].amountCents == 10)
    }

    @Test func assignsAndClearsTheAccountOfACategory() {
        var budget = month()
        let category = budget.expenseCategories[0].id
        let savings = budget.accounts[1].id
        budget.setCategoryAccount(categoryId: category, accountId: savings)
        #expect(budget.expenseCategories[0].accountId == savings)
        #expect(budget.categoryCount(usingAccount: savings) == 1)
        budget.setCategoryAccount(categoryId: category, accountId: nil)
        #expect(budget.expenseCategories[0].accountId == nil)
        budget.setCategoryAccount(categoryId: category, accountId: "ghost")
        #expect(budget.expenseCategories[0].accountId == nil)
    }

    @Test func movesRowsInEachList() throws {
        var budget = month()
        budget.addCategory(name: "Second", accountId: nil)
        budget.addItem(name: "Extra", amountCents: 1, toCategory: budget.expenseCategories[0].id)
        let firstCategory = budget.expenseCategories[0].id
        let names = budget.expenseCategories[0].items.map(\.name)

        budget.move(.incomes, fromOffsets: IndexSet(integer: 1), toOffset: 0)
        #expect(budget.incomes.map(\.name) == ["Bonus", "Main income"])
        budget.move(.accounts, fromOffsets: IndexSet(integer: 0), toOffset: 2)
        #expect(budget.accounts.map(\.name) == ["Savings", "Main account"])
        budget.move(.categories, fromOffsets: IndexSet(integer: 1), toOffset: 0)
        #expect(budget.expenseCategories[1].id == firstCategory)
        budget.move(.items(categoryId: firstCategory), fromOffsets: IndexSet(integer: 0), toOffset: 2)
        #expect(budget.expenseCategories[1].items.map(\.name) == [names[1], names[0]])

        #expect(contiguous(budget.incomes) && contiguous(budget.accounts))
        #expect(contiguous(budget.expenseCategories) && contiguous(budget.expenseCategories[1].items))
    }

    @Test func removingAnIncomeOrItemCanBeUndoneInPlace() throws {
        var budget = month()
        let first = budget.incomes[0].id
        let removedRow = budget.removeRow(.incomes, id: first)
        let removed = try #require(removedRow)
        #expect(budget.incomes.map(\.name) == ["Bonus"])
        #expect(removed.name == "Main income")
        budget.restore(removed)
        #expect(budget.incomes.map(\.name) == ["Main income", "Bonus"])
        #expect(contiguous(budget.incomes))
        budget.restore(removed) // already back: no duplicate
        #expect(budget.incomes.count == 2)

        let category = budget.expenseCategories[0].id
        let item = budget.expenseCategories[0].items[0].id
        let removedItemRow = budget.removeRow(.items(categoryId: category), id: item)
        let removedItem = try #require(removedItemRow)
        #expect(budget.expenseCategories[0].items.isEmpty)
        budget.restore(removedItem)
        #expect(budget.expenseCategories[0].items.map(\.id) == [item])
    }

    @Test func accountsAndCategoriesCannotBeRemovedAsRows() {
        var budget = month()
        #expect(budget.removeRow(.accounts, id: budget.accounts[0].id) == nil)
        #expect(budget.removeRow(.categories, id: budget.expenseCategories[0].id) == nil)
    }

    @Test func removingAnAccountUnassignsItsCategories() {
        var budget = month()
        let main = budget.accounts[0].id
        #expect(budget.categoryCount(usingAccount: main) == 1)
        budget.removeAccount(id: main)
        #expect(budget.accounts.map(\.name) == ["Savings"])
        #expect(budget.accounts[0].sortOrder == 0)
        #expect(budget.expenseCategories[0].accountId == nil)
    }

    @Test func removingACategoryDropsItsExpenses() {
        var budget = month()
        budget.addCategory(name: "Second", accountId: nil)
        budget.removeCategory(id: budget.expenseCategories[0].id)
        #expect(budget.expenseCategories.map(\.name) == ["Second"])
        #expect(budget.expenseCategories[0].sortOrder == 0)
    }

    @Test func allocationReflectsTheAssignedAccount() {
        var budget = month()
        let savings = budget.accounts[1].id
        budget.setAmount(.items(categoryId: budget.expenseCategories[0].id),
                         id: budget.expenseCategories[0].items[0].id, cents: 150_00)
        budget.setCategoryAccount(categoryId: budget.expenseCategories[0].id, accountId: savings)
        let allocation = budget.summary.accountAllocations[1]
        #expect(allocation.usageCents == 150_00)
        #expect(allocation.balanceCents == 150_00)
        #expect(allocationUsagePercent(allocation) == 50)
    }
}
