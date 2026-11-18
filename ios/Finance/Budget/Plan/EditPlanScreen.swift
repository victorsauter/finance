import FinanceKit
import SwiftUI

/// The whole month in one list: incomes, accounts with their allocation
/// status, and expense categories (each opens its own screen for expenses).
struct EditPlanScreen: View {
    @Environment(BudgetStore.self) private var store
    @State private var entry: PlanEntry?
    @State private var deletion: PlanDeletion?
    @State private var isConfirmingReset = false

    var body: some View {
        let month = store.month
        let summary = month.summary

        List {
            if store.isVirtual {
                Section {
                    Label("Nothing is saved for this month yet. Your first change saves a copy of the plan below.", systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            incomeSection(month, total: summary.incomeCents)
            accountSection(month, summary: summary)
            categorySection(month, total: summary.expenseCents)
            Section {
                Button("Reset month", systemImage: "arrow.counterclockwise", role: .destructive) {
                    isConfirmingReset = true
                }
                .tint(.red)
            } footer: {
                Text("Goes back to the plan of the closest earlier month.")
            }
        }
        .navigationTitle("Edit plan")
        .navigationSubtitle(month.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { EditButton() } }
        .sheet(item: $entry) { entry in
            EntrySheet(entry: entry, month: store.month)
                .presentationDetents([.medium])
        }
        .planDeletionDialog($deletion)
        .resetMonthDialog(isPresented: $isConfirmingReset)
        .undoBanner()
        .sensoryFeedback(.success, trigger: store.month.updatedAt)
    }

    // MARK: Income

    private func incomeSection(_ month: BudgetMonth, total: Int) -> some View {
        Section {
            ForEach(month.incomes) { income in
                Button { entry = .editIncome(income.id) } label: {
                    LabeledContent(income.name) {
                        Text(Money.format(income.amountCents)).monospacedDigit()
                    }
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        withAnimation(.smooth) { store.removeRow(.incomes, id: income.id) }
                    }
                    .tint(.red)
                }
                .contextMenu {
                    Button("Edit", systemImage: "pencil") { entry = .editIncome(income.id) }
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        withAnimation(.smooth) { store.removeRow(.incomes, id: income.id) }
                    }
                }
            }
            .onMove { store.move(.incomes, fromOffsets: $0, toOffset: $1) }
            addButton("Add income") { entry = .newIncome }
        } header: {
            sectionHeader("Income", total: total)
        }
    }

    // MARK: Accounts

    private func accountSection(_ month: BudgetMonth, summary: BudgetSummary) -> some View {
        Section {
            ForEach(month.accounts) { account in
                let allocation = summary.accountAllocations.first { $0.accountId == account.id }
                Button { entry = .editAccount(account.id) } label: {
                    AccountRow(account: account, allocation: allocation)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deletion = .account(
                            account, categoryCount: month.categoryCount(usingAccount: account.id)
                        )
                    }
                    .tint(.red)
                }
                .contextMenu {
                    Button("Edit", systemImage: "pencil") { entry = .editAccount(account.id) }
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deletion = .account(
                            account, categoryCount: month.categoryCount(usingAccount: account.id)
                        )
                    }
                }
            }
            .onMove { store.move(.accounts, fromOffsets: $0, toOffset: $1) }

            if summary.unassignedExpenseCents > 0 {
                LabeledContent {
                    Text(Money.format(summary.unassignedExpenseCents)).monospacedDigit()
                } label: {
                    Label("Not paid from an account", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
                .font(.subheadline)
            }
            addButton("Add account") { entry = .newAccount }
        } header: {
            sectionHeader("Accounts", total: summary.transferCents)
        } footer: {
            Text("Each account receives a planned transfer. Categories paid from it use that money.")
        }
    }

    // MARK: Categories

    private func categorySection(_ month: BudgetMonth, total: Int) -> some View {
        Section {
            ForEach(Array(month.expenseCategories.enumerated()), id: \.element.id) { index, category in
                NavigationLink {
                    CategoryEditScreen(categoryID: category.id)
                } label: {
                    CategoryRow(
                        category: category,
                        accountName: month.accounts.first { $0.id == category.accountId }?.name,
                        symbol: CategorySymbol.symbol(for: category, at: index),
                        color: Theme.categoryColor(at: index)
                    )
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deletion = .category(category)
                    }
                    .tint(.red)
                    Button("Rename", systemImage: "pencil") {
                        entry = .renameCategory(category.id)
                    }
                    .tint(.indigo)
                }
                .contextMenu {
                    Button("Rename", systemImage: "pencil") { entry = .renameCategory(category.id) }
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deletion = .category(category)
                    }
                }
            }
            .onMove { store.move(.categories, fromOffsets: $0, toOffset: $1) }
            addButton("Add category") { entry = .newCategory }
        } header: {
            sectionHeader("Categories", total: total)
        }
    }

    // MARK: Pieces

    private func sectionHeader(_ title: String, total: Int) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(Money.format(total)).monospacedDigit()
        }
    }

    private func addButton(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(title, systemImage: "plus.circle.fill", action: action)
            .font(.body.weight(.medium))
    }
}

private struct AccountRow: View {
    let account: Account
    let allocation: AccountAllocation?

    private var usage: Int { allocation?.usageCents ?? 0 }
    private var isOver: Bool { usage > account.plannedTransferCents }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledContent(account.name) {
                Text(Money.format(account.plannedTransferCents)).monospacedDigit()
            }
            .font(.body)

            if let allocation, let percent = allocationUsagePercent(allocation) {
                ProgressView(value: min(Double(usage) / Double(account.plannedTransferCents), 1))
                    .tint(isOver ? Theme.expense : Theme.primary)
                ViewThatFits(in: .horizontal) {
                    HStack {
                        used(percent)
                        Spacer()
                        balance(allocation)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        used(percent)
                        balance(allocation)
                    }
                }
                .font(.caption)
            } else if usage > 0 {
                Label("\(Money.format(usage)) of expenses, no transfer planned", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else {
                Text("No transfer planned")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    private func used(_ percent: Int) -> some View {
        Text("\(Money.format(usage)) used · \(percent)%")
            .foregroundStyle(.secondary)
    }

    private func balance(_ allocation: AccountAllocation) -> some View {
        let over = allocation.balanceCents < 0
        return Text(over
            ? "\(Money.format(-allocation.balanceCents)) over"
            : "\(Money.format(allocation.balanceCents)) left")
            .fontWeight(.medium)
            .foregroundStyle(over ? Theme.expense : Color.secondary)
    }
}

private struct CategoryRow: View {
    let category: ExpenseCategory
    let accountName: String?
    let symbol: String
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(color.gradient, in: .rect(cornerRadius: 10))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(category.name)
                Text(accountName ?? "No account")
                    .font(.caption)
                    .foregroundStyle(accountName == nil ? .orange : .secondary)
            }

            Spacer(minLength: 8)

            Text(Money.format(category.totalCents))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
