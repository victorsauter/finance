import Foundation
import Testing
@testable import FinanceKit

@Suite struct TransactionsTests {
    private func transaction(
        _ id: String, date: String, cents: Int, kind: ImportedTransactionKind = .expense,
        category: String? = nil, fee: Int = 0, currency: String = "EUR"
    ) -> ImportedTransaction {
        ImportedTransaction(
            id: id, sourceKey: "key-\(id)", sourceReference: nil,
            importBatchId: createId(), sourceFileName: "statement.csv",
            bookingDate: date, startedAt: nil, completedAt: nil,
            description: "Shop \(id)", amountCents: cents, feeCents: fee,
            balanceCents: nil, currency: currency, transactionType: nil,
            product: nil, kind: kind, categoryId: category, importedAt: isoTimestamp()
        )
    }

    /// November 2026 with a category, December without any budget.
    private func data() -> (AppData, categoryId: String) {
        let budget = createEmptyBudgetMonth(year: 2026, month: 11)
        let category = budget.expenseCategories[0].id
        var data = AppData(
            settings: AppSettings(activeBudgetMonthId: budget.id),
            budgetMonths: [budget]
        )
        data.importedTransactions = [
            transaction("a", date: "2026-11-03", cents: -12_00, category: category),
            transaction("b", date: "2026-11-20", cents: -5_00),
            transaction("c", date: "2026-11-20", cents: 900_00, kind: .income),
            transaction("d", date: "2026-12-01", cents: -7_00),
        ]
        return (data, category)
    }

    @Test func listsAMonthNewestFirst() {
        let (data, _) = data()
        #expect(data.transactions(inMonth: "2026-11").map(\.id) == ["c", "b", "a"])
        #expect(data.transactions(inMonth: "2026-12").map(\.id) == ["d"])
        #expect(data.transactions(inMonth: "2027-01").isEmpty)
    }

    @Test func changingKindAwayFromExpenseClearsTheCategory() throws {
        var (data, _) = data()
        data.setTransactionKind(id: "a", kind: .transfer)
        let changed = try #require(data.importedTransactions.first { $0.id == "a" })
        #expect(changed.kind == .transfer)
        #expect(changed.categoryId == nil)
        data.setTransactionKind(id: "a", kind: .expense)
        #expect(data.importedTransactions.first { $0.id == "a" }?.kind == .expense)
        data.setTransactionKind(id: "ghost", kind: .income)
    }

    @Test func categoryMustExistInTheBookingMonth() {
        var (data, category) = data()
        data.setTransactionCategory(id: "b", categoryId: category)
        #expect(data.importedTransactions.first { $0.id == "b" }?.categoryId == category)

        data.setTransactionCategory(id: "b", categoryId: "not-a-category")
        #expect(data.importedTransactions.first { $0.id == "b" }?.categoryId == category)

        // December has no budget, so nothing can be assigned there.
        data.setTransactionCategory(id: "d", categoryId: category)
        #expect(data.importedTransactions.first { $0.id == "d" }?.categoryId == nil)

        // Only expenses take a category.
        data.setTransactionCategory(id: "c", categoryId: category)
        #expect(data.importedTransactions.first { $0.id == "c" }?.categoryId == nil)

        data.setTransactionCategory(id: "b", categoryId: nil)
        #expect(data.importedTransactions.first { $0.id == "b" }?.categoryId == nil)
    }

    @Test func removedCategoriesAreUnlinked() {
        var (data, category) = data()
        data.budgetMonths[0].removeCategory(id: category)
        data.unlinkMissingCategories(year: 2026, month: 11)
        #expect(data.importedTransactions.allSatisfy { $0.categoryId == nil })
    }

    @Test func resetKeepsIdentityAndReseedsFromTheEarlierMonth() throws {
        var (data, category) = data()
        var october = createEmptyBudgetMonth(year: 2026, month: 10)
        october.addCategory(name: "From October", accountId: nil)
        data.budgetMonths.append(october)
        let november = try #require(findBudget(in: data, year: 2026, month: 11))

        data.resetBudgetMonth(id: november.id)
        let reset = try #require(findBudget(in: data, year: 2026, month: 11))
        #expect(reset.id == november.id)
        #expect(reset.createdAt == november.createdAt)
        #expect(reset.expenseCategories.map(\.name) == october.expenseCategories.map(\.name))
        #expect(reset.expenseCategories.allSatisfy { $0.id != category })
        #expect(data.importedTransactions.first { $0.id == "a" }?.categoryId == nil)
        #expect(data.budgetMonths.count == 2)
    }

    @Test func summaryMatchesTheWebRules() {
        let (data, _) = data()
        var extra = data.transactions(inMonth: "2026-11")
        extra.append(transaction("e", date: "2026-11-09", cents: -20_00, fee: 1_00))
        extra.append(transaction("f", date: "2026-11-10", cents: -40_00, currency: "CHF"))
        let summary = summarizeMonth(extra, budget: data.budgetMonths[0])
        // -12 and -5 and -20 plus a fee of 1; the CHF one is excluded.
        #expect(summary.actualExpenseCents == 38_00)
        #expect(summary.actualIncomeCents == 900_00)
        #expect(summary.unclassifiedCount == 3) // b, e, f
        #expect(summary.nonEuroCount == 1)
        #expect(summary.plannedExpenseCents == 0)
        #expect(summarizeMonth([], budget: nil).plannedExpenseCents == 0)
    }
}
