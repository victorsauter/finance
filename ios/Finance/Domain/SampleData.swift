import Foundation

/// Made-up figures for the prototype. Nothing here comes from real accounts.
nonisolated enum SampleData {
    static let months: [BudgetMonth] = [
        month(2026, 9, bonus: 0, groceries: 420_00, leisure: 180_00, travel: 0),
        month(2026, 10, bonus: 0, groceries: 465_50, leisure: 240_00, travel: 320_00),
        month(2026, 11, bonus: 450_00, groceries: 440_00, leisure: 150_00, travel: 0),
    ]

    private static func month(
        _ year: Int, _ month: Int,
        bonus: Int, groceries: Int, leisure: Int, travel: Int
    ) -> BudgetMonth {
        var incomes = [Income(id: UUID(), name: "Salary", amountCents: 3_200_00)]
        if bonus > 0 {
            incomes.append(Income(id: UUID(), name: "Bonus", amountCents: bonus))
        }

        var categories = [
            category("Housing", "house.fill", [
                ("Rent", 1_150_00), ("Electricity", 62_00), ("Internet", 34_99),
            ]),
            category("Food", "cart.fill", [
                ("Groceries", groceries), ("Lunches", 96_00),
            ]),
            category("Transport", "tram.fill", [
                ("Transit pass", 88_80), ("Bike upkeep", 25_00),
            ]),
            category("Leisure", "sparkles", [
                ("Going out", leisure), ("Subscriptions", 28_98),
            ]),
        ]
        if travel > 0 {
            categories.append(category("Travel", "airplane", [("Weekend away", travel)]))
        }

        return BudgetMonth(
            id: UUID(), year: year, month: month,
            incomes: incomes, categories: categories
        )
    }

    private static func category(
        _ name: String, _ symbol: String, _ items: [(String, Int)]
    ) -> ExpenseCategory {
        ExpenseCategory(
            id: UUID(), name: name, symbol: symbol,
            items: items.map { ExpenseItem(id: UUID(), name: $0.0, amountCents: $0.1) }
        )
    }
}
