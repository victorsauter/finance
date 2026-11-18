import Foundation

// Prototype subset of `src/domain/budget/models.ts`: incomes and expense
// categories only. Accounts and planned transfers are left out.
// Amounts are integer cents, as in the web app.

nonisolated struct Income: Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var amountCents: Int
}

nonisolated struct ExpenseItem: Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var amountCents: Int
}

nonisolated struct ExpenseCategory: Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    /// SF Symbol name. Prototype only: the web model has no icon.
    var symbol: String
    var items: [ExpenseItem]

    var totalCents: Int {
        items.reduce(0) { $0 + $1.amountCents }
    }
}

nonisolated struct BudgetSummary: Hashable, Sendable {
    var incomeCents: Int
    var expenseCents: Int

    var remainingCents: Int { incomeCents - expenseCents }

    /// Share of income left after planned expenses, between 0 and 1.
    var savingsRate: Double {
        incomeCents == 0 ? 0 : Double(remainingCents) / Double(incomeCents)
    }
}

nonisolated struct BudgetMonth: Identifiable, Hashable, Sendable {
    let id: UUID
    var year: Int
    var month: Int
    var incomes: [Income]
    var categories: [ExpenseCategory]

    var summary: BudgetSummary {
        BudgetSummary(
            incomeCents: incomes.reduce(0) { $0 + $1.amountCents },
            expenseCents: categories.reduce(0) { $0 + $1.totalCents }
        )
    }

    var title: String {
        let components = DateComponents(year: year, month: month, day: 1)
        guard let date = Calendar(identifier: .gregorian).date(from: components) else {
            return "\(month)/\(year)"
        }
        return date.formatted(
            .dateTime.month(.wide).year().locale(Money.locale)
        )
    }
}

nonisolated enum Money {
    static let locale = Locale(identifier: "en_GB")

    /// Whole amounts drop the decimals; anything else shows two.
    static func format(_ cents: Int) -> String {
        let digits = cents % 100 == 0 ? 0 : 2
        return (Decimal(cents) / 100).formatted(
            .currency(code: "EUR")
                .precision(.fractionLength(digits))
                .locale(locale)
        )
    }

    /// "43%" for 0.43.
    static func percent(_ ratio: Double) -> String {
        ratio.formatted(.percent.precision(.fractionLength(0)).locale(locale))
    }

    /// Parses "12", "12.5" or "12,50" into cents. Nil for anything else or
    /// for amounts that are not strictly positive.
    static func parse(_ text: String) -> Int? {
        let normalized = text
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: ",", with: ".")
        guard !normalized.isEmpty,
              normalized.allSatisfy({ $0.isNumber || $0 == "." }),
              let value = Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX"))
        else { return nil }
        let cents = NSDecimalNumber(decimal: value * 100).rounding(
            accordingToBehavior: NSDecimalNumberHandler(
                roundingMode: .plain, scale: 0,
                raiseOnExactness: false, raiseOnOverflow: false,
                raiseOnUnderflow: false, raiseOnDivideByZero: false
            )
        ).intValue
        return cents > 0 ? cents : nil
    }
}
