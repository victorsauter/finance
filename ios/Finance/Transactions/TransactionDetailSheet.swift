import FinanceKit
import SwiftUI

/// Change what a transaction is (expense, income, transfer) and which budget
/// category an expense belongs to. Edits apply at once, like on the web.
struct TransactionDetailSheet: View {
    let transactionID: ImportedTransaction.ID

    @Environment(BudgetStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            if let transaction = store.transaction(id: transactionID) {
                content(transaction)
            } else {
                ContentUnavailableView("Transaction not found", systemImage: "questionmark.circle")
            }
        }
    }

    private func content(_ transaction: ImportedTransaction) -> some View {
        let budget = store.budget(for: transaction)

        return Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(transaction.description)
                        .font(.headline)
                    Text(Money.formatTransaction(transaction.amountCents, currency: transaction.currency))
                        .font(.largeTitle.bold())
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .foregroundStyle(transaction.kind.amountColor)
                    Text(transaction.bookingDate)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }

            Section("Type") {
                Picker("Type", selection: Binding(
                    get: { transaction.kind },
                    set: { store.setTransactionKind(id: transaction.id, kind: $0) }
                )) {
                    ForEach([ImportedTransactionKind.expense, .income, .transfer], id: \.self) {
                        Text($0.label).tag($0)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            categorySection(transaction, budget: budget)

            Section("Details") {
                if transaction.feeCents > 0 {
                    LabeledContent("Fee") {
                        Text(Money.formatTransaction(transaction.feeCents, currency: transaction.currency))
                            .monospacedDigit()
                    }
                }
                LabeledContent("Currency", value: transaction.currency)
                LabeledContent("Imported from", value: transaction.sourceFileName)
            }
        }
        .navigationTitle("Transaction")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done", systemImage: "checkmark") { dismiss() }
            }
        }
        .sensoryFeedback(.selection, trigger: transaction.kind)
        .sensoryFeedback(.selection, trigger: transaction.categoryId)
    }

    @ViewBuilder
    private func categorySection(_ transaction: ImportedTransaction, budget: BudgetMonth?) -> some View {
        Section("Category") {
            if transaction.kind != .expense {
                Text("Only expenses belong to a category.")
                    .foregroundStyle(.secondary)
            } else if let budget, !budget.expenseCategories.isEmpty {
                Picker("Category", selection: Binding(
                    get: { transaction.categoryId },
                    set: { store.setTransactionCategory(id: transaction.id, categoryID: $0) }
                )) {
                    Text("To classify").tag(String?.none)
                    ForEach(budget.expenseCategories) { category in
                        Text(category.name).tag(Optional(category.id))
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } else {
                Text(budget == nil
                    ? "This month has no saved budget yet. Edit its plan in the Budget tab, then classify its expenses here."
                    : "This month's budget has no categories yet.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
