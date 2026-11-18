import Foundation

// Imported bank transactions as the iPhone app handles them: read, classify,
// keep consistent with the budget. Importing a CSV stays on the web.

/// Totals for one month, as in `src/features/transactions/month-summary.ts`.
public struct TransactionSummary: Hashable, Sendable {
    /// EUR expenses including fees.
    public var actualExpenseCents: Int
    public var actualIncomeCents: Int
    public var plannedExpenseCents: Int
    /// Expenses without a category.
    public var unclassifiedCount: Int
    /// Transactions left out of the EUR totals.
    public var nonEuroCount: Int
}

public func summarizeMonth(
    _ transactions: [ImportedTransaction], budget: BudgetMonth?
) -> TransactionSummary {
    let euro = transactions.filter { $0.currency == "EUR" }
    let actualExpense = euro.reduce(0) { total, transaction in
        total + transaction.feeCents
            + (transaction.kind == .expense && transaction.amountCents < 0
                ? -transaction.amountCents : 0)
    }
    let actualIncome = euro.reduce(0) { total, transaction in
        transaction.kind == .income && transaction.amountCents > 0
            ? total + transaction.amountCents : total
    }
    return TransactionSummary(
        actualExpenseCents: actualExpense,
        actualIncomeCents: actualIncome,
        plannedExpenseCents: budget?.expenseCategories.reduce(0) { $0 + $1.totalCents } ?? 0,
        unclassifiedCount: transactions.filter {
            $0.kind == .expense && $0.categoryId == nil
        }.count,
        nonEuroCount: transactions.count - euro.count
    )
}

extension AppData {
    /// Transactions booked in the month `YYYY-MM`, newest first.
    public func transactions(inMonth key: String) -> [ImportedTransaction] {
        importedTransactions
            .filter { $0.bookingDate.hasPrefix(key) }
            .sorted { ($0.bookingDate, $0.id) > ($1.bookingDate, $1.id) }
    }

    /// Changes the kind. Only expenses carry a category, so any other kind
    /// clears it, as on the web.
    public mutating func setTransactionKind(id: String, kind: ImportedTransactionKind) {
        guard let index = importedTransactions.firstIndex(where: { $0.id == id }) else { return }
        importedTransactions[index].kind = kind
        if kind != .expense { importedTransactions[index].categoryId = nil }
    }

    /// Assigns an expense category of the budget for the booking month, or
    /// clears it with nil. Ignored when that month has no such category.
    public mutating func setTransactionCategory(id: String, categoryId: String?) {
        guard let index = importedTransactions.firstIndex(where: { $0.id == id }) else { return }
        if let categoryId {
            guard importedTransactions[index].kind == .expense,
                  let budget = budget(forBookingDate: importedTransactions[index].bookingDate),
                  budget.expenseCategories.contains(where: { $0.id == categoryId })
            else { return }
        }
        importedTransactions[index].categoryId = categoryId
    }

    /// Clears the category of transactions of that month whose category no
    /// longer exists in its budget. Call after the budget changes.
    public mutating func unlinkMissingCategories(year: Int, month: Int) {
        let key = monthKey(year: year, month: month)
        let present = Set(
            findBudget(in: self, year: year, month: month)?
                .expenseCategories.map(\.id) ?? []
        )
        for index in importedTransactions.indices {
            let transaction = importedTransactions[index]
            if transaction.bookingDate.hasPrefix(key),
               let categoryId = transaction.categoryId,
               !present.contains(categoryId) {
                importedTransactions[index].categoryId = nil
            }
        }
    }

    /// Puts a saved month back to the plan of the nearest earlier month (or an
    /// empty plan). Keeps its id and creation date; transactions lose the
    /// categories that disappear.
    public mutating func resetBudgetMonth(id: String, now: Date = Date()) {
        guard let index = budgetMonths.firstIndex(where: { $0.id == id }) else { return }
        let current = budgetMonths[index]
        var fresh = seedMonthFrom(self, year: current.year, month: current.month, now: now)
        fresh.id = current.id
        fresh.createdAt = current.createdAt
        budgetMonths[index] = fresh
        unlinkMissingCategories(year: current.year, month: current.month)
    }

    private func budget(forBookingDate date: String) -> BudgetMonth? {
        budgetMonths.first { monthKey(year: $0.year, month: $0.month) == String(date.prefix(7)) }
    }
}
