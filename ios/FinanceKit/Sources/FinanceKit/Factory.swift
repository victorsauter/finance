import Foundation

// Port of the parts of `src/domain/budget/factory.ts` the app needs.
// `ordering.ts` is not ported: nothing here depends on it yet.

public struct YearMonth: Hashable, Sendable {
    public var year: Int
    public var month: Int

    public init(year: Int, month: Int) {
        self.year = year
        self.month = month
    }
}

/// Lowercase UUID, like `crypto.randomUUID()`.
public func createId() -> String {
    UUID().uuidString.lowercased()
}

/// ISO 8601 UTC with milliseconds, like `Date.toISOString()`.
public func isoTimestamp(_ date: Date = Date()) -> String {
    date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
}

private let englishMonthNames = [
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
]

/// "November 2026", matching the web app's en-GB label.
public func getMonthName(year: Int, month: Int) -> String {
    guard (1...12).contains(month) else { return "\(month)/\(year)" }
    return "\(englishMonthNames[month - 1]) \(year)"
}

public func createIncome(name: String, sortOrder: Int) -> Income {
    Income(id: createId(), name: name, amountCents: 0, sortOrder: sortOrder)
}

public func createAccount(name: String, sortOrder: Int) -> Account {
    Account(id: createId(), name: name, plannedTransferCents: 0, sortOrder: sortOrder)
}

public func createExpenseItem(name: String, sortOrder: Int) -> ExpenseItem {
    ExpenseItem(id: createId(), name: name, amountCents: 0, sortOrder: sortOrder)
}

public func createExpenseCategory(
    name: String, sortOrder: Int, accountId: String? = nil
) -> ExpenseCategory {
    ExpenseCategory(
        id: createId(), name: name, accountId: accountId,
        items: [createExpenseItem(name: "New expense", sortOrder: 0)],
        sortOrder: sortOrder
    )
}

public func createEmptyBudgetMonth(
    year: Int, month: Int, now: Date = Date()
) -> BudgetMonth {
    let timestamp = isoTimestamp(now)
    let account = createAccount(name: "Main account", sortOrder: 0)
    var housing = createExpenseCategory(name: "Housing", sortOrder: 0, accountId: account.id)
    housing.items = [createExpenseItem(name: "Rent / mortgage", sortOrder: 0)]

    return BudgetMonth(
        id: createId(), year: year, month: month,
        name: getMonthName(year: year, month: month),
        incomes: [createIncome(name: "Main income", sortOrder: 0)],
        accounts: [account],
        expenseCategories: [housing],
        createdAt: timestamp, updatedAt: timestamp
    )
}

public func createInitialAppData(
    date: Date = Date(), calendar: Calendar = .current
) -> AppData {
    let parts = calendar.dateComponents([.year, .month], from: date)
    let budget = createEmptyBudgetMonth(
        year: parts.year ?? 2026, month: parts.month ?? 1, now: date
    )
    return AppData(
        settings: AppSettings(activeBudgetMonthId: budget.id),
        budgetMonths: [budget]
    )
}

/// Copy of `source` for another month, with fresh identifiers.
public func cloneBudgetMonth(
    _ source: BudgetMonth, year: Int, month: Int, now: Date = Date()
) -> BudgetMonth {
    let timestamp = isoTimestamp(now)
    var accountIds: [String: String] = [:]
    let accounts = source.accounts.map { account -> Account in
        var copy = account
        copy.id = createId()
        accountIds[account.id] = copy.id
        return copy
    }

    var clone = source
    clone.id = createId()
    clone.year = year
    clone.month = month
    clone.name = getMonthName(year: year, month: month)
    clone.incomes = source.incomes.map { income in
        var copy = income
        copy.id = createId()
        return copy
    }
    clone.accounts = accounts
    clone.expenseCategories = source.expenseCategories.map { category in
        var copy = category
        copy.id = createId()
        copy.accountId = category.accountId.flatMap { accountIds[$0] }
        copy.items = category.items.map { item in
            var itemCopy = item
            itemCopy.id = createId()
            return itemCopy
        }
        return copy
    }
    clone.createdAt = timestamp
    clone.updatedAt = timestamp
    return clone
}

public func nextMonth(year: Int, month: Int) -> YearMonth {
    month == 12
        ? YearMonth(year: year + 1, month: 1)
        : YearMonth(year: year, month: month + 1)
}

public func previousMonth(year: Int, month: Int) -> YearMonth {
    month == 1
        ? YearMonth(year: year - 1, month: 12)
        : YearMonth(year: year, month: month - 1)
}

/// Canonical `YYYY-MM` key of a budget month.
public func monthKey(year: Int, month: Int) -> String {
    let padded = month < 10 ? "0\(month)" : "\(month)"
    return "\(year)-\(padded)"
}

/// True when the month can be stored: a real month of a supported year.
public func isBudgetMonthInRange(year: Int, month: Int) -> Bool {
    year >= minBudgetYear && year <= maxBudgetYear && month >= 1 && month <= 12
}

public func findBudget(in data: AppData, year: Int, month: Int) -> BudgetMonth? {
    data.budgetMonths.first { $0.year == year && $0.month == month }
}

/// Content of a month that does not exist yet: a copy of the nearest earlier
/// month (fresh identifiers), or an empty month when nothing precedes it.
public func seedMonthFrom(
    _ data: AppData, year: Int, month: Int, now: Date = Date()
) -> BudgetMonth {
    func index(_ budget: BudgetMonth) -> Int { budget.year * 12 + budget.month }
    let target = year * 12 + month
    let nearest = data.budgetMonths
        .filter { index($0) < target }
        .max { index($0) < index($1) }

    if let nearest {
        return cloneBudgetMonth(nearest, year: year, month: month, now: now)
    }
    return createEmptyBudgetMonth(year: year, month: month, now: now)
}
