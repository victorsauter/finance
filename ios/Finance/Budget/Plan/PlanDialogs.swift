import FinanceKit
import SwiftUI

/// Deletions that ask first, because they reach beyond one row: an account
/// unassigns its categories, a category drops all its expenses.
enum PlanDeletion: Identifiable {
    case account(Account, categoryCount: Int)
    case category(ExpenseCategory)

    var id: String {
        switch self {
        case .account(let account, _): account.id
        case .category(let category): category.id
        }
    }

    var title: String {
        switch self {
        case .account(let account, _): "Delete \(account.name)?"
        case .category(let category): "Delete \(category.name)?"
        }
    }

    var message: String {
        switch self {
        case .account(_, let count) where count == 1:
            "1 category uses this account. It will become unassigned."
        case .account(_, let count) where count > 1:
            "\(count) categories use this account. They will become unassigned."
        case .account:
            "This account will be removed from the budget."
        case .category(let category) where !category.items.isEmpty:
            "The category and its \(category.items.count) expense\(category.items.count == 1 ? "" : "s") will be removed."
        case .category:
            "The category will be removed."
        }
    }

    var confirmLabel: String {
        switch self {
        case .account: "Delete account"
        case .category: "Delete category"
        }
    }
}

private struct PlanDeletionDialog: ViewModifier {
    @Environment(BudgetStore.self) private var store
    @Binding var deletion: PlanDeletion?
    var onDeleted: () -> Void

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                deletion?.title ?? "",
                isPresented: Binding(
                    get: { deletion != nil },
                    set: { if !$0 { deletion = nil } }
                ),
                titleVisibility: .visible,
                presenting: deletion
            ) { item in
                Button(item.confirmLabel, role: .destructive) {
                    withAnimation(.smooth) {
                        switch item {
                        case .account(let account, _): store.removeAccount(id: account.id)
                        case .category(let category): store.removeCategory(id: category.id)
                        }
                    }
                    onDeleted()
                }
            } message: { item in
                Text(item.message)
            }
            .sensoryFeedback(.warning, trigger: deletion?.id) { _, new in new != nil }
    }
}

private struct ResetMonthDialog: ViewModifier {
    @Environment(BudgetStore.self) private var store
    @Binding var isPresented: Bool

    func body(content: Content) -> some View {
        content.confirmationDialog(
            "Reset \(store.month.name)?",
            isPresented: $isPresented,
            titleVisibility: .visible
        ) {
            Button("Reset month", role: .destructive) {
                withAnimation(.smooth) { store.resetMonth() }
            }
        } message: {
            Text("This month goes back to the plan of the closest earlier month, or to an empty plan. Transactions keep their place but lose categories that no longer exist.")
        }
    }
}

extension View {
    func planDeletionDialog(
        _ deletion: Binding<PlanDeletion?>, onDeleted: @escaping () -> Void = {}
    ) -> some View {
        modifier(PlanDeletionDialog(deletion: deletion, onDeleted: onDeleted))
    }

    func resetMonthDialog(isPresented: Binding<Bool>) -> some View {
        modifier(ResetMonthDialog(isPresented: isPresented))
    }
}
