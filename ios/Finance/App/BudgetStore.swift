import FinanceKit
import Observation
import os

/// Holds the budget document, saves it after every change and exposes the
/// active month to the screens. No network.
@Observable
final class BudgetStore {
    private(set) var data: AppData
    private let repository: any BudgetRepository
    private var lastSave: Task<Void, Never>?

    init(data: AppData, repository: any BudgetRepository) {
        self.data = data
        self.repository = repository
    }

    /// Reads the saved document, or seeds first launch with `seed` and saves it.
    /// Throws when a saved file exists but cannot be read, so it is never
    /// overwritten by accident.
    static func load(
        from repository: any BudgetRepository,
        seed: @autoclosure () -> AppData = SampleData.appData()
    ) async throws -> BudgetStore {
        if let saved = try await repository.load() {
            return BudgetStore(data: saved, repository: repository)
        }
        let store = BudgetStore(data: seed(), repository: repository)
        store.persist()
        return store
    }

    /// Months in chronological order.
    private var months: [BudgetMonth] {
        data.budgetMonths.sorted { ($0.year, $0.month) < ($1.year, $1.month) }
    }

    private var index: Int {
        let months = months
        return months.firstIndex { $0.id == data.settings.activeBudgetMonthId }
            ?? max(months.count - 1, 0)
    }

    var month: BudgetMonth { months[index] }
    var hasPrevious: Bool { index > 0 }
    var hasNext: Bool { index < months.count - 1 }

    func step(_ delta: Int) {
        let months = months
        let target = index + delta
        guard months.indices.contains(target) else { return }
        data.settings.activeBudgetMonthId = months[target].id
        persist()
    }

    func addExpense(name: String, amountCents: Int, to categoryID: ExpenseCategory.ID) {
        let monthID = month.id
        guard let monthIndex = data.budgetMonths.firstIndex(where: { $0.id == monthID }),
              let categoryIndex = data.budgetMonths[monthIndex].expenseCategories
                .firstIndex(where: { $0.id == categoryID })
        else { return }

        var item = createExpenseItem(
            name: name,
            sortOrder: data.budgetMonths[monthIndex].expenseCategories[categoryIndex].items.count
        )
        item.amountCents = amountCents
        data.budgetMonths[monthIndex].expenseCategories[categoryIndex].items.append(item)
        data.budgetMonths[monthIndex].updatedAt = isoTimestamp()
        persist()
    }

    /// Saves the latest document. Saves run one after another so an older
    /// snapshot can never overwrite a newer one.
    private func persist() {
        let snapshot = data
        let previous = lastSave
        lastSave = Task { [repository] in
            await previous?.value
            do {
                try await repository.save(snapshot)
            } catch {
                Logger(subsystem: "dev.finance.prototype", category: "persistence")
                    .error("Saving the budget failed: \(error.localizedDescription)")
            }
        }
    }
}
