import SwiftUI

struct AddExpenseSheet: View {
    @Environment(BudgetStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var amount = ""
    @State private var categoryID: ExpenseCategory.ID?
    @FocusState private var nameIsFocused: Bool

    private var amountCents: Int? { Money.parse(amount) }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                    .focused($nameIsFocused)
                TextField("Amount in euros", text: $amount)
                    .keyboardType(.decimalPad)
                Picker("Category", selection: $categoryID) {
                    ForEach(store.month.categories) { category in
                        Text(category.name).tag(Optional(category.id))
                    }
                }
            }
            .navigationTitle("New expense")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", systemImage: "checkmark", action: add)
                        .disabled(amountCents == nil || trimmedName.isEmpty || categoryID == nil)
                }
            }
            .onAppear {
                categoryID = store.month.categories.first?.id
                nameIsFocused = true
            }
        }
    }

    private func add() {
        guard let amountCents, let categoryID else { return }
        withAnimation(.smooth) {
            store.addExpense(name: trimmedName, amountCents: amountCents, to: categoryID)
        }
        dismiss()
    }
}
