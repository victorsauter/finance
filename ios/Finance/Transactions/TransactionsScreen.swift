import FinanceKit
import SwiftUI

/// Imported bank transactions of the selected month, grouped by day. Imports
/// happen on the web; here they can be searched and classified.
struct TransactionsScreen: View {
    @Environment(BudgetStore.self) private var store
    @State private var search = ""
    @State private var detail: ImportedTransaction?
    @State private var isPickingMonth = false

    var body: some View {
        let all = store.transactions
        let shown = filtered(all)
        let days = group(shown)

        NavigationStack {
            List {
                if !all.isEmpty && search.isEmpty {
                    summarySection(all)
                }
                ForEach(days, id: \.date) { day in
                    Section(dayTitle(day.date)) {
                        ForEach(day.rows) { transaction in
                            Button { detail = transaction } label: {
                                TransactionRow(
                                    transaction: transaction,
                                    categoryName: categoryName(for: transaction)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .overlay {
                if all.isEmpty {
                    emptyState
                } else if shown.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .navigationTitle("Transactions")
            .navigationSubtitle(store.month.name)
            .toolbar { MonthToolbar(isPickingMonth: $isPickingMonth) }
            .searchable(text: $search, prompt: "Search descriptions")
            .monthPickerSheet(isPresented: $isPickingMonth)
            .sheet(item: $detail) { transaction in
                TransactionDetailSheet(transactionID: transaction.id)
                    .presentationDetents([.medium, .large])
            }
            .sensoryFeedback(.selection, trigger: store.selected)
        }
    }

    // MARK: Pieces

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No transactions in \(store.month.name)", systemImage: "tray")
        } description: {
            Text("Transactions come from Revolut CSV statements, which are imported on the web app. Import a backup from the Account tab to bring them here.")
        }
    }

    private func summarySection(_ transactions: [ImportedTransaction]) -> some View {
        let budget = store.isVirtual ? nil : store.month
        let summary = summarizeMonth(transactions, budget: budget)

        return Section {
            LabeledContent("Spent") {
                Text(Money.format(summary.actualExpenseCents))
                    .font(.title3.bold())
                    .monospacedDigit()
                    .foregroundStyle(.primary)
            }
            if budget != nil {
                LabeledContent("Planned") {
                    Text(Money.format(summary.plannedExpenseCents)).monospacedDigit()
                }
            }
            if summary.actualIncomeCents > 0 {
                LabeledContent("Income") {
                    Text(Money.format(summary.actualIncomeCents))
                        .monospacedDigit()
                        .foregroundStyle(.green)
                }
            }
            if summary.unclassifiedCount > 0 {
                Label("\(summary.unclassifiedCount) to classify", systemImage: "tag")
                    .foregroundStyle(.orange)
            }
            if summary.nonEuroCount > 0 {
                Label(
                    "\(summary.nonEuroCount) in another currency, left out of the totals",
                    systemImage: "eurosign.circle"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }

    private func categoryName(for transaction: ImportedTransaction) -> String? {
        guard let id = transaction.categoryId else { return nil }
        return store.budget(for: transaction)?
            .expenseCategories.first { $0.id == id }?.name
    }

    private func filtered(_ transactions: [ImportedTransaction]) -> [ImportedTransaction] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return transactions }
        return transactions.filter { $0.description.localizedStandardContains(query) }
    }

    /// Input is newest first, so days and rows keep that order.
    private func group(_ transactions: [ImportedTransaction]) -> [(date: String, rows: [ImportedTransaction])] {
        var result: [(date: String, rows: [ImportedTransaction])] = []
        for transaction in transactions {
            if result.last?.date == transaction.bookingDate {
                result[result.count - 1].rows.append(transaction)
            } else {
                result.append((transaction.bookingDate, [transaction]))
            }
        }
        return result
    }

    private func dayTitle(_ isoDate: String) -> String {
        let parts = isoDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
              let date = Calendar.current.date(
                from: DateComponents(year: parts[0], month: parts[1], day: parts[2])
              )
        else { return isoDate }
        return date.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Money.locale))
    }
}

extension ImportedTransactionKind {
    var label: String {
        switch self {
        case .expense: "Expense"
        case .income: "Income"
        case .transfer: "Transfer"
        }
    }

    /// Colour of the amount: expenses red, income green, transfers neutral.
    var amountColor: Color {
        switch self {
        case .expense: .red
        case .income: .green
        case .transfer: .secondary
        }
    }

    var symbol: String {
        switch self {
        case .expense: "arrow.up.right"
        case .income: "arrow.down.left"
        case .transfer: "arrow.left.arrow.right"
        }
    }
}
