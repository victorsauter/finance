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
            budgetMonths: months,
            importedTransactions: transactions(for: months)
        )
    }

    // MARK: Transactions

    private typealias Row = (
        date: String, name: String, cents: Int, kind: ImportedTransactionKind,
        category: String?, fee: Int, currency: String
    )

    private static func expense(
        _ date: String, _ name: String, _ cents: Int, _ category: String?,
        fee: Int = 0, currency: String = "EUR"
    ) -> Row {
        (date, name, -cents, .expense, category, fee, currency)
    }

    /// A few made-up bank lines per month, some still to classify, so the
    /// Transactions tab has something to show.
    private static func transactions(for months: [BudgetMonth]) -> [ImportedTransaction] {
        let rows: [(month: Int, rows: [Row])] = [
            (9, [
                expense("2026-09-04", "Supermarket Lumen", 71_20, "Food"),
                expense("2026-09-19", "Cinema Aurora", 28_00, "Leisure"),
                ("2026-09-26", "Salary", 3_200_00, .income, nil, 0, "EUR"),
            ]),
            (10, [
                expense("2026-10-03", "Supermarket Lumen", 84_30, "Food"),
                expense("2026-10-08", "Transit pass", 88_80, "Transport"),
                expense("2026-10-17", "Weekend train tickets", 142_00, "Travel"),
                expense("2026-10-22", "Corner café", 9_40, nil),
                ("2026-10-26", "Salary", 3_200_00, .income, nil, 0, "EUR"),
            ]),
            (11, [
                expense("2026-11-02", "Landlord transfer", 1_150_00, "Housing"),
                expense("2026-11-03", "Supermarket Lumen", 62_40, "Food"),
                expense("2026-11-05", "Transit pass", 88_80, "Transport"),
                expense("2026-11-06", "Cinema Aurora", 14_00, nil),
                expense("2026-11-09", "Bakery Mill", 6_80, "Food"),
                ("2026-11-10", "Salary", 3_200_00, .income, nil, 0, "EUR"),
                ("2026-11-12", "Savings top-up", -400_00, .transfer, nil, 0, "EUR"),
                expense("2026-11-14", "Corner café", 4_50, nil),
                expense("2026-11-15", "Electricity Co", 62_00, "Housing"),
                expense("2026-11-16", "Bike workshop", 25_00, "Transport", fee: 50),
                expense("2026-11-17", "Hotel Alpenblick", 120_00, nil, currency: "CHF"),
            ]),
        ]

        var result: [ImportedTransaction] = []
        for group in rows {
            guard let budget = months.first(where: { $0.month == group.month }) else { continue }
            let batch = createId()
            for row in group.rows {
                let categoryId = row.category.flatMap { name in
                    budget.expenseCategories.first { $0.name == name }?.id
                }
                result.append(ImportedTransaction(
                    id: createId(), sourceKey: "sample-\(result.count)",
                    sourceReference: nil, importBatchId: batch,
                    sourceFileName: "sample-statement.csv",
                    bookingDate: row.date, startedAt: nil, completedAt: nil,
                    description: row.name, amountCents: row.cents, feeCents: row.fee,
                    balanceCents: nil, currency: row.currency, transactionType: nil,
                    product: nil, kind: row.kind, categoryId: categoryId,
                    importedAt: isoTimestamp()
                ))
            }
        }
        return result
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
