import Foundation

// Mutations of one budget month behind the "Edit plan" screens. They mirror
// `useBudgetEditor.ts`. Each keeps `sortOrder` contiguous and ignores blank
// names, unknown ids and unknown accounts rather than failing.

/// Which ordered list of the month a row belongs to.
public enum BudgetList: Hashable, Sendable {
    case incomes
    case accounts
    case categories
    case items(categoryId: String)
}

/// A row taken out of a month, with enough to put it back where it was.
public enum RemovedRow: Hashable, Sendable {
    case income(Income, index: Int)
    case item(ExpenseItem, categoryId: String, index: Int)

    public var name: String {
        switch self {
        case .income(let income, _): income.name
        case .item(let item, _, _): item.name
        }
    }
}

extension BudgetMonth {
    /// Number of categories that point at `accountId`.
    public func categoryCount(usingAccount accountId: String) -> Int {
        expenseCategories.filter { $0.accountId == accountId }.count
    }

    @discardableResult
    public mutating func addIncome(name: String, amountCents: Int) -> String? {
        guard let name = Self.cleaned(name) else { return nil }
        var income = createIncome(name: name, sortOrder: incomes.count)
        income.amountCents = amountCents
        incomes.append(income)
        return income.id
    }

    @discardableResult
    public mutating func addAccount(name: String, plannedTransferCents: Int) -> String? {
        guard let name = Self.cleaned(name) else { return nil }
        var account = createAccount(name: name, sortOrder: accounts.count)
        account.plannedTransferCents = plannedTransferCents
        accounts.append(account)
        return account.id
    }

    /// A new category starts empty; `accountId` must name an account of the
    /// month, otherwise the category is left unassigned.
    @discardableResult
    public mutating func addCategory(name: String, accountId: String?) -> String? {
        guard let name = Self.cleaned(name) else { return nil }
        var category = createExpenseCategory(
            name: name, sortOrder: expenseCategories.count,
            accountId: validAccountId(accountId)
        )
        category.items = []
        expenseCategories.append(category)
        return category.id
    }

    @discardableResult
    public mutating func addItem(
        name: String, amountCents: Int, toCategory categoryId: String
    ) -> String? {
        guard let name = Self.cleaned(name),
              let index = expenseCategories.firstIndex(where: { $0.id == categoryId })
        else { return nil }
        var item = createExpenseItem(
            name: name, sortOrder: expenseCategories[index].items.count
        )
        item.amountCents = amountCents
        expenseCategories[index].items.append(item)
        return item.id
    }

    public mutating func rename(_ list: BudgetList, id: String, to name: String) {
        guard let name = Self.cleaned(name) else { return }
        switch list {
        case .incomes:
            if let i = incomes.firstIndex(where: { $0.id == id }) { incomes[i].name = name }
        case .accounts:
            if let i = accounts.firstIndex(where: { $0.id == id }) { accounts[i].name = name }
        case .categories:
            if let i = expenseCategories.firstIndex(where: { $0.id == id }) {
                expenseCategories[i].name = name
            }
        case .items(let categoryId):
            if let c = expenseCategories.firstIndex(where: { $0.id == categoryId }),
               let i = expenseCategories[c].items.firstIndex(where: { $0.id == id }) {
                expenseCategories[c].items[i].name = name
            }
        }
    }

    /// Categories have no amount of their own, so that case does nothing.
    public mutating func setAmount(_ list: BudgetList, id: String, cents: Int) {
        guard cents >= 0 else { return }
        switch list {
        case .incomes:
            if let i = incomes.firstIndex(where: { $0.id == id }) { incomes[i].amountCents = cents }
        case .accounts:
            if let i = accounts.firstIndex(where: { $0.id == id }) {
                accounts[i].plannedTransferCents = cents
            }
        case .categories:
            break
        case .items(let categoryId):
            if let c = expenseCategories.firstIndex(where: { $0.id == categoryId }),
               let i = expenseCategories[c].items.firstIndex(where: { $0.id == id }) {
                expenseCategories[c].items[i].amountCents = cents
            }
        }
    }

    /// Assigns a category to an account, or to none with nil. An id that is
    /// not an account of this month leaves the category unassigned.
    public mutating func setCategoryAccount(categoryId: String, accountId: String?) {
        guard let index = expenseCategories.firstIndex(where: { $0.id == categoryId }) else { return }
        expenseCategories[index].accountId = validAccountId(accountId)
    }

    public mutating func move(_ list: BudgetList, fromOffsets offsets: IndexSet, toOffset destination: Int) {
        switch list {
        case .incomes:
            FinanceKit.move(&incomes, fromOffsets: offsets, toOffset: destination)
        case .accounts:
            FinanceKit.move(&accounts, fromOffsets: offsets, toOffset: destination)
        case .categories:
            FinanceKit.move(&expenseCategories, fromOffsets: offsets, toOffset: destination)
        case .items(let categoryId):
            if let c = expenseCategories.firstIndex(where: { $0.id == categoryId }) {
                FinanceKit.move(&expenseCategories[c].items, fromOffsets: offsets, toOffset: destination)
            }
        }
    }

    /// Removes an income or an expense, returning what is needed to undo it.
    public mutating func removeRow(_ list: BudgetList, id: String) -> RemovedRow? {
        switch list {
        case .incomes:
            return removeById(&incomes, id: id).map { .income($0.item, index: $0.index) }
        case .items(let categoryId):
            guard let c = expenseCategories.firstIndex(where: { $0.id == categoryId }) else { return nil }
            return removeById(&expenseCategories[c].items, id: id)
                .map { .item($0.item, categoryId: categoryId, index: $0.index) }
        case .accounts, .categories:
            return nil
        }
    }

    /// Puts a removed row back at its old position, unless it is already there.
    public mutating func restore(_ row: RemovedRow) {
        switch row {
        case .income(let income, let index):
            guard !incomes.contains(where: { $0.id == income.id }) else { return }
            insertAt(&incomes, income, at: index)
        case .item(let item, let categoryId, let index):
            guard let c = expenseCategories.firstIndex(where: { $0.id == categoryId }),
                  !expenseCategories[c].items.contains(where: { $0.id == item.id })
            else { return }
            insertAt(&expenseCategories[c].items, item, at: index)
        }
    }

    /// Removes an account; categories that used it become unassigned.
    public mutating func removeAccount(id: String) {
        guard removeById(&accounts, id: id) != nil else { return }
        for index in expenseCategories.indices where expenseCategories[index].accountId == id {
            expenseCategories[index].accountId = nil
        }
    }

    /// Removes a category with all its expenses.
    public mutating func removeCategory(id: String) {
        _ = removeById(&expenseCategories, id: id)
    }

    private func validAccountId(_ accountId: String?) -> String? {
        guard let accountId, accounts.contains(where: { $0.id == accountId }) else { return nil }
        return accountId
    }

    private static func cleaned(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
