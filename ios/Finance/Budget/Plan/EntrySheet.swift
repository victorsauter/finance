import FinanceKit
import SwiftUI

/// What the shared name-and-amount sheet is adding or editing.
enum PlanEntry: Identifiable, Hashable {
    case newIncome
    case editIncome(String)
    case newAccount
    case editAccount(String)
    case newCategory
    case renameCategory(String)
    case newItem(categoryID: String)
    case editItem(categoryID: String, id: String)

    var id: Self { self }

    var isNew: Bool {
        switch self {
        case .newIncome, .newAccount, .newCategory, .newItem: true
        default: false
        }
    }

    var title: String {
        switch self {
        case .newIncome: "New income"
        case .editIncome: "Edit income"
        case .newAccount: "New account"
        case .editAccount: "Edit account"
        case .newCategory: "New category"
        case .renameCategory: "Rename category"
        case .newItem: "New expense"
        case .editItem: "Edit expense"
        }
    }

    /// Categories have no amount of their own: it is the sum of their expenses.
    var amountLabel: String? {
        switch self {
        case .newIncome, .editIncome: "Monthly amount"
        case .newAccount, .editAccount: "Planned transfer"
        case .newItem, .editItem: "Amount"
        case .newCategory, .renameCategory: nil
        }
    }

    var namePrompt: String {
        switch self {
        case .newIncome, .editIncome: "Salary"
        case .newAccount, .editAccount: "Main account"
        case .newCategory, .renameCategory: "Groceries"
        case .newItem, .editItem: "Electricity"
        }
    }
}

/// One sheet for every row of the plan: a name, an amount where the row has
/// one, and for a new category the account that pays for it.
struct EntrySheet: View {
    let entry: PlanEntry
    private let accounts: [Account]

    @Environment(BudgetStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var amount: String
    @State private var accountID: String?
    @FocusState private var nameIsFocused: Bool

    init(entry: PlanEntry, month: BudgetMonth) {
        self.entry = entry
        accounts = month.accounts

        var initialName = ""
        var initialCents = 0
        switch entry {
        case .editIncome(let id):
            if let income = month.incomes.first(where: { $0.id == id }) {
                (initialName, initialCents) = (income.name, income.amountCents)
            }
        case .editAccount(let id):
            if let account = month.accounts.first(where: { $0.id == id }) {
                (initialName, initialCents) = (account.name, account.plannedTransferCents)
            }
        case .renameCategory(let id):
            initialName = month.expenseCategories.first { $0.id == id }?.name ?? ""
        case .editItem(let categoryID, let id):
            let item = month.expenseCategories.first { $0.id == categoryID }?
                .items.first { $0.id == id }
            if let item { (initialName, initialCents) = (item.name, item.amountCents) }
        case .newIncome, .newAccount, .newCategory, .newItem:
            break
        }
        _name = State(initialValue: initialName)
        _amount = State(initialValue: Money.inputText(initialCents))
        _accountID = State(initialValue: entry == .newCategory ? month.accounts.first?.id : nil)
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var cents: Int? {
        entry.amountLabel == nil ? 0 : Money.parse(amount, allowZero: true)
    }
    private var canSave: Bool { cents != nil && !trimmedName.isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name, prompt: Text(entry.namePrompt))
                        .focused($nameIsFocused)
                        .submitLabel(.done)
                    if let label = entry.amountLabel {
                        LabeledContent(label) {
                            HStack(spacing: 4) {
                                Text("€").foregroundStyle(.secondary)
                                TextField("Amount", text: $amount, prompt: Text("0"))
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                                    .monospacedDigit()
                                    .accessibilityLabel("\(label) in euros")
                            }
                        }
                    }
                } footer: {
                    if cents == nil {
                        Text("Enter an amount such as 12.50: at most two decimals, up to 1,000,000,000.")
                            .foregroundStyle(.red)
                    }
                }

                if entry == .newCategory, !accounts.isEmpty {
                    Section {
                        Picker("Paid from", selection: $accountID) {
                            Text("No account").tag(String?.none)
                            ForEach(accounts) { account in
                                Text(account.name).tag(Optional(account.id))
                            }
                        }
                    }
                }
            }
            .navigationTitle(entry.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(entry.isNew ? "Add" : "Save", role: .confirm, action: save)
                        .disabled(!canSave)
                }
            }
            .onAppear { nameIsFocused = entry.isNew }
        }
    }

    private func save() {
        guard let cents else { return }
        let name = trimmedName
        withAnimation(.smooth) {
            switch entry {
            case .newIncome:
                store.addIncome(name: name, amountCents: cents)
            case .editIncome(let id):
                store.rename(.incomes, id: id, to: name)
                store.setAmount(.incomes, id: id, cents: cents)
            case .newAccount:
                store.addAccount(name: name, plannedTransferCents: cents)
            case .editAccount(let id):
                store.rename(.accounts, id: id, to: name)
                store.setAmount(.accounts, id: id, cents: cents)
            case .newCategory:
                store.addCategory(name: name, accountId: accountID)
            case .renameCategory(let id):
                store.rename(.categories, id: id, to: name)
            case .newItem(let categoryID):
                store.addItem(name: name, amountCents: cents, to: categoryID)
            case .editItem(let categoryID, let id):
                store.rename(.items(categoryId: categoryID), id: id, to: name)
                store.setAmount(.items(categoryId: categoryID), id: id, cents: cents)
            }
        }
        dismiss()
    }
}
