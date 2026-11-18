import FinanceKit
import Foundation

/// Made-up figures that seed the first launch. Nothing here comes from real
/// accounts.
nonisolated enum SampleData {
    static func appData() -> AppData {
        let months = [
            month(2026, 9, bonus: 0, groceries: 420_00, leisure: 180_00, travel: 0),
            month(2026, 10, bonus: 0, groceries: 465_50, leisure: 240_00, travel: 320_00),
            month(2026, 11, bonus: 450_00, groceries: 440_00, leisure: 150_00, travel: 0),
        ]
        return AppData(
            settings: AppSettings(activeBudgetMonthId: months.last?.id),
            budgetMonths: months
        )
    }

    private static func month(
        _ year: Int, _ month: Int,
        bonus: Int, groceries: Int, leisure: Int, travel: Int
    ) -> BudgetMonth {
        var incomes = [income("Salary", 3_200_00, 0)]
        if bonus > 0 {
            incomes.append(income("Bonus", bonus, 1))
        }

        let account = Account(
            id: createId(), name: "Main account",
            plannedTransferCents: 2_500_00, sortOrder: 0
        )
        var categories = [
            category("Housing", account, 0, [
                ("Rent", 1_150_00), ("Electricity", 62_00), ("Internet", 34_99),
            ]),
            category("Food", account, 1, [
                ("Groceries", groceries), ("Lunches", 96_00),
            ]),
            category("Transport", account, 2, [
                ("Transit pass", 88_80), ("Bike upkeep", 25_00),
            ]),
            category("Leisure", account, 3, [
                ("Going out", leisure), ("Subscriptions", 28_98),
            ]),
        ]
        if travel > 0 {
            categories.append(category("Travel", account, 4, [("Weekend away", travel)]))
        }

        let timestamp = isoTimestamp()
        return BudgetMonth(
            id: createId(), year: year, month: month,
            name: getMonthName(year: year, month: month),
            incomes: incomes, accounts: [account],
            expenseCategories: categories,
            createdAt: timestamp, updatedAt: timestamp
        )
    }

    private static func income(_ name: String, _ cents: Int, _ order: Int) -> Income {
        Income(id: createId(), name: name, amountCents: cents, sortOrder: order)
    }

    private static func category(
        _ name: String, _ account: Account, _ order: Int, _ items: [(String, Int)]
    ) -> ExpenseCategory {
        ExpenseCategory(
            id: createId(), name: name, accountId: account.id,
            items: items.enumerated().map { index, item in
                ExpenseItem(
                    id: createId(), name: item.0,
                    amountCents: item.1, sortOrder: index
                )
            },
            sortOrder: order
        )
    }
}
