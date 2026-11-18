import Observation

/// In-memory state for the prototype. No persistence, no network.
@Observable
final class BudgetStore {
    private(set) var months: [BudgetMonth] = SampleData.months
    private(set) var index: Int = SampleData.months.count - 1

    var month: BudgetMonth { months[index] }
    var hasPrevious: Bool { index > 0 }
    var hasNext: Bool { index < months.count - 1 }

    func step(_ delta: Int) {
        let target = index + delta
        guard months.indices.contains(target) else { return }
        index = target
    }

    func addExpense(name: String, amountCents: Int, to categoryID: ExpenseCategory.ID) {
        guard let position = months[index].categories.firstIndex(where: { $0.id == categoryID })
        else { return }
        months[index].categories[position].items.append(
            ExpenseItem(id: .init(), name: name, amountCents: amountCents)
        )
    }
}
