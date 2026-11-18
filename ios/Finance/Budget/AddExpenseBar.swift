import FinanceKit
import SwiftUI

/// The floating bar above the tab bar. It lives in the budget screen rather
/// than in `tabViewBottomAccessory`: presenting a sheet from a pushed screen
/// while the accessory exists hangs SwiftUI in an attribute cycle.
struct AddExpenseBar: View {
    @Environment(BudgetStore.self) private var store
    let action: () -> Void

    var body: some View {
        let left = Money.format(store.month.summary.remainingCents)

        Button(action: action) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    icon
                    Text("Add an expense")
                        .fontWeight(.medium)
                        .lineLimit(1)
                        .fixedSize()
                    Spacer(minLength: 8)
                    amount(left)
                }
                HStack(spacing: 10) {
                    icon
                    amount(left)
                }
            }
            .padding(.horizontal, 16)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add an expense")
        .accessibilityValue("\(left) left")
    }

    private var icon: some View {
        Image(systemName: "plus.circle.fill")
            .font(.title3)
            .foregroundStyle(Theme.primary)
    }

    private func amount(_ text: String) -> some View {
        Text(text)
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(.secondary)
            .contentTransition(.numericText())
    }
}
