import FinanceKit
import Foundation
import Observation
import os

/// A deletion that can still be undone.
struct UndoNotice: Identifiable {
    let id = UUID()
    let noun: String
    let name: String
    fileprivate let row: RemovedRow
    fileprivate let monthID: String
}

/// Holds the budget document, saves it after every change and exposes the
/// selected month to the screens. No network.
///
/// Any month of 2000-2200 can be selected. One with no saved data is
/// "virtual": it shows a copy of the nearest earlier month and is only added
/// to the document by its first edit, so browsing never writes anything.
@Observable
final class BudgetStore {
    private(set) var data: AppData
    private(set) var selected: YearMonth
    private(set) var undoNotice: UndoNotice?
    /// Content of `selected` while it has no saved month. Cached so ids stay
    /// stable until the first edit saves it.
    private var virtual: BudgetMonth?
    private let repository: any BudgetRepository
    private var lastSave: Task<Void, Never>?

    init(data: AppData, repository: any BudgetRepository) {
        self.data = data
        self.repository = repository
        let latest = data.budgetMonths.max { ($0.year, $0.month) < ($1.year, $1.month) }
        let start = data.budgetMonths.first { $0.id == data.settings.activeBudgetMonthId } ?? latest
        selected = start.map { YearMonth(year: $0.year, month: $0.month) } ?? Self.currentMonth()
        select(year: selected.year, month: selected.month)
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

    static func currentMonth(_ date: Date = Date()) -> YearMonth {
        let parts = Calendar.current.dateComponents([.year, .month], from: date)
        return YearMonth(year: parts.year ?? 2026, month: parts.month ?? 1)
    }

    // MARK: Months

    private var savedIndex: Int? {
        data.budgetMonths.firstIndex { $0.year == selected.year && $0.month == selected.month }
    }

    /// The month on screen: saved, or the virtual copy.
    var month: BudgetMonth {
        if let index = savedIndex { return data.budgetMonths[index] }
        return virtual ?? createEmptyBudgetMonth(year: selected.year, month: selected.month)
    }

    var isVirtual: Bool { savedIndex == nil }

    /// `YYYY-MM` of the selected month.
    var selectedKey: String { monthKey(year: selected.year, month: selected.month) }

    /// `YYYY-MM` keys of the months that hold saved data.
    var savedKeys: Set<String> {
        Set(data.budgetMonths.map { monthKey(year: $0.year, month: $0.month) })
    }

    /// The month the plan was copied from, when the selection is virtual.
    var seedSourceName: String? {
        guard isVirtual else { return nil }
        let target = selected.year * 12 + selected.month
        return data.budgetMonths
            .filter { $0.year * 12 + $0.month < target }
            .max { ($0.year, $0.month) < ($1.year, $1.month) }?.name
    }

    func select(year: Int, month: Int) {
        guard isBudgetMonthInRange(year: year, month: month) else { return }
        selected = YearMonth(year: year, month: month)
        virtual = savedIndex == nil
            ? seedMonthFrom(data, year: year, month: month)
            : nil
    }

    func canStep(_ delta: Int) -> Bool {
        let target = stepped(delta)
        return isBudgetMonthInRange(year: target.year, month: target.month)
    }

    /// Moves one calendar month back (-1) or forward (+1).
    func step(_ delta: Int) {
        let target = stepped(delta)
        select(year: target.year, month: target.month)
    }

    private func stepped(_ delta: Int) -> YearMonth {
        delta < 0
            ? previousMonth(year: selected.year, month: selected.month)
            : nextMonth(year: selected.year, month: selected.month)
    }

    /// Back to the plan of the nearest earlier month, or an empty plan.
    func resetMonth() {
        if let index = savedIndex {
            let id = data.budgetMonths[index].id
            data.resetBudgetMonth(id: id)
            data.settings.activeBudgetMonthId = id
            undoNotice = nil
            persist()
        } else {
            virtual = seedMonthFrom(data, year: selected.year, month: selected.month)
        }
    }

    // MARK: Editing the plan

    /// Applies `change` to the selected month. The first edit of a virtual
    /// month saves it; an edit that changes nothing writes nothing.
    private func commit(_ change: (inout BudgetMonth) -> Void) {
        var budget = month
        let before = budget
        change(&budget)
        guard budget != before else { return }
        budget.updatedAt = isoTimestamp()
        if let index = savedIndex {
            data.budgetMonths[index] = budget
        } else {
            data.budgetMonths.append(budget)
            virtual = nil
        }
        data.settings.activeBudgetMonthId = budget.id
        data.unlinkMissingCategories(year: budget.year, month: budget.month)
        persist()
    }

    func addIncome(name: String, amountCents: Int) {
        commit { $0.addIncome(name: name, amountCents: amountCents) }
    }

    func addAccount(name: String, plannedTransferCents: Int) {
        commit { $0.addAccount(name: name, plannedTransferCents: plannedTransferCents) }
    }

    func addCategory(name: String, accountId: String?) {
        commit { $0.addCategory(name: name, accountId: accountId) }
    }

    func addItem(name: String, amountCents: Int, to categoryID: ExpenseCategory.ID) {
        commit { $0.addItem(name: name, amountCents: amountCents, toCategory: categoryID) }
    }

    /// Quick add from the bottom bar.
    func addExpense(name: String, amountCents: Int, to categoryID: ExpenseCategory.ID) {
        addItem(name: name, amountCents: amountCents, to: categoryID)
    }

    func rename(_ list: BudgetList, id: String, to name: String) {
        commit { $0.rename(list, id: id, to: name) }
    }

    func setAmount(_ list: BudgetList, id: String, cents: Int) {
        commit { $0.setAmount(list, id: id, cents: cents) }
    }

    func setCategoryAccount(categoryID: String, accountID: String?) {
        commit { $0.setCategoryAccount(categoryId: categoryID, accountId: accountID) }
    }

    func move(_ list: BudgetList, fromOffsets offsets: IndexSet, toOffset destination: Int) {
        commit { $0.move(list, fromOffsets: offsets, toOffset: destination) }
    }

    func removeAccount(id: String) {
        commit { $0.removeAccount(id: id) }
    }

    func removeCategory(id: String) {
        commit { $0.removeCategory(id: id) }
    }

    /// Removes an income or an expense and offers an undo.
    func removeRow(_ list: BudgetList, id: String) {
        var removed: RemovedRow?
        commit { removed = $0.removeRow(list, id: id) }
        guard let removed else { return }
        let noun: String = if case .income = removed { "Income" } else { "Expense" }
        undoNotice = UndoNotice(
            noun: noun, name: removed.name, row: removed, monthID: month.id
        )
    }

    func undoRemoval() {
        guard let notice = undoNotice else { return }
        undoNotice = nil
        guard let index = data.budgetMonths.firstIndex(where: { $0.id == notice.monthID })
        else { return }
        var budget = data.budgetMonths[index]
        budget.restore(notice.row)
        guard budget != data.budgetMonths[index] else { return }
        budget.updatedAt = isoTimestamp()
        data.budgetMonths[index] = budget
        persist()
    }

    func dismissUndo(_ id: UndoNotice.ID) {
        if undoNotice?.id == id { undoNotice = nil }
    }

    // MARK: Transactions

    /// Transactions booked in the selected month, newest first.
    var transactions: [ImportedTransaction] {
        data.transactions(inMonth: selectedKey)
    }

    func transaction(id: String) -> ImportedTransaction? {
        data.importedTransactions.first { $0.id == id }
    }

    /// The saved budget a transaction is classified against, if its month has one.
    func budget(for transaction: ImportedTransaction) -> BudgetMonth? {
        let key = String(transaction.bookingDate.prefix(7))
        return data.budgetMonths.first { monthKey(year: $0.year, month: $0.month) == key }
    }

    func setTransactionKind(id: String, kind: ImportedTransactionKind) {
        data.setTransactionKind(id: id, kind: kind)
        persist()
    }

    func setTransactionCategory(id: String, categoryID: String?) {
        data.setTransactionCategory(id: id, categoryId: categoryID)
        persist()
    }

    // MARK: Backup

    /// Replaces everything with an already validated document.
    func replaceData(with replacement: AppData) {
        data = replacement
        undoNotice = nil
        let start = replacement.budgetMonths.first { $0.id == replacement.settings.activeBudgetMonthId }
            ?? replacement.budgetMonths.first
        let target = start.map { YearMonth(year: $0.year, month: $0.month) } ?? Self.currentMonth()
        select(year: target.year, month: target.month)
        persist()
    }

    func resetToSampleData() {
        replaceData(with: SampleData.appData())
    }

    func backupDocument() throws -> BackupDocument {
        BackupDocument(data: try BackupFile.encode(data))
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
