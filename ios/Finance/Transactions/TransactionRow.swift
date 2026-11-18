import FinanceKit
import SwiftUI

struct TransactionRow: View {
    let transaction: ImportedTransaction
    /// Name of the assigned category, when there is one.
    let categoryName: String?

    @Environment(\.dynamicTypeSize) private var typeSize

    private var amountText: String {
        Money.formatTransaction(transaction.amountCents, currency: transaction.currency)
    }

    private var needsClassifying: Bool {
        transaction.kind == .expense && categoryName == nil
    }

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 12))

        layout {
            HStack(spacing: 12) {
                Image(systemName: transaction.kind.symbol)
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(transaction.kind.amountColor)
                    .frame(width: 32, height: 32)
                    .background(transaction.kind.amountColor.opacity(0.14), in: .circle)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(transaction.description)
                        .lineLimit(2)
                    subtitle
                        .font(.caption)
                }
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            Text(amountText)
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(transaction.kind.amountColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows details")
    }

    @ViewBuilder private var subtitle: some View {
        if needsClassifying {
            Label("To classify", systemImage: "tag")
                .foregroundStyle(.orange)
        } else if let categoryName {
            Text(categoryName).foregroundStyle(.secondary)
        } else {
            Text(transaction.kind.label).foregroundStyle(.secondary)
        }
    }
}
