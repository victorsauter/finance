import FinanceKit
import SwiftUI

/// One category: the account that pays for it and its expenses.
struct CategoryEditScreen: View {
    let categoryID: ExpenseCategory.ID

    @Environment(BudgetStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var entry: PlanEntry?
    @State private var deletion: PlanDeletion?

    private var category: ExpenseCategory? {
        store.month.expenseCategories.first { $0.id == categoryID }
    }

    var body: some View {
        Group {
            if let category {
                content(category)
            } else {
                ContentUnavailableView("Category removed", systemImage: "tag.slash")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $entry) { entry in
            EntrySheet(entry: entry, month: store.month)
                .presentationDetents([.medium])
        }
        .planDeletionDialog($deletion) { dismiss() }
        .undoBanner()
    }

    private func content(_ category: ExpenseCategory) -> some View {
        let list = BudgetList.items(categoryId: category.id)
        let accounts = store.month.accounts

        return List {
            if !accounts.isEmpty {
                Section {
                    Picker("Paid from", selection: Binding(
                        get: { category.accountId },
                        set: { store.setCategoryAccount(categoryID: category.id, accountID: $0) }
                    )) {
                        Text("No account").tag(String?.none)
                        ForEach(accounts) { account in
                            Text(account.name).tag(Optional(account.id))
                        }
                    }
                } footer: {
                    Text("The planned transfer of this account covers the expenses of its categories.")
                }
            }

            Section {
                ForEach(category.items) { item in
                    Button { entry = .editItem(categoryID: category.id, id: item.id) } label: {
                        LabeledContent(item.name) {
                            Text(Money.format(item.amountCents)).monospacedDigit()
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing) {
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            withAnimation(.smooth) { store.removeRow(list, id: item.id) }
                        }
                        .tint(.red)
                    }
                    .contextMenu {
                        Button("Edit", systemImage: "pencil") {
                            entry = .editItem(categoryID: category.id, id: item.id)
                        }
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            withAnimation(.smooth) { store.removeRow(list, id: item.id) }
                        }
                    }
                }
                .onMove { store.move(list, fromOffsets: $0, toOffset: $1) }

                Button("Add expense", systemImage: "plus.circle.fill") {
                    entry = .newItem(categoryID: category.id)
                }
                .font(.body.weight(.medium))
            } header: {
                HStack {
                    Text("Expenses")
                    Spacer()
                    Text(Money.format(category.totalCents)).monospacedDigit()
                }
            }
        }
        .navigationTitle(category.name)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { EditButton() }
            ToolbarItem(placement: .topBarTrailing) {
                Menu("More", systemImage: "ellipsis") {
                    Button("Rename", systemImage: "pencil") { entry = .renameCategory(category.id) }
                    Button("Delete category", systemImage: "trash", role: .destructive) {
                        deletion = .category(category)
                    }
                }
            }
        }
    }
}
