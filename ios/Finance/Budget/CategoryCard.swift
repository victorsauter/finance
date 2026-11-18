import FinanceKit
import SwiftUI

struct CategoryCard: View {
    let category: ExpenseCategory
    let symbol: String
    let color: Color
    let incomeCents: Int
    let isExpanded: Bool
    let isHighlighted: Bool
    let onToggle: () -> Void

    private var share: Double {
        incomeCents == 0 ? 0 : Double(category.totalCents) / Double(incomeCents)
    }

    var body: some View {
        VStack(spacing: 14) {
            Button(action: onToggle) {
                HStack(spacing: 12) {
                    Image(systemName: symbol)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(color.gradient, in: .rect(cornerRadius: 12))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(category.name)
                            .font(.headline)
                        Text("\(Money.percent(share)) of income")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 8)

                    Text(Money.format(category.totalCents))
                        .font(.body.weight(.semibold))
                        .monospacedDigit()
                        .contentTransition(.numericText())

                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(isExpanded ? "Hides the expenses" : "Shows the expenses")

            ProgressView(value: min(share, 1))
                .tint(color)

            if isExpanded {
                VStack(spacing: 10) {
                    ForEach(category.items) { item in
                        HStack {
                            Text(item.name)
                            Spacer()
                            Text(Money.format(item.amountCents))
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                        .font(.subheadline)
                    }
                }
                .padding(.top, 2)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .strokeBorder(color, lineWidth: isHighlighted ? 2 : 0)
        }
        .clipShape(.rect(cornerRadius: 22))
    }
}
