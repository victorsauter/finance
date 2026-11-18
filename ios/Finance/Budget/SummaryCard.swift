import SwiftUI

struct SummaryCard: View {
    let summary: BudgetSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Left this month")
                    .font(.subheadline.weight(.medium))
                    .opacity(0.85)
                Text(Money.format(summary.remainingCents))
                    .font(.system(size: 46, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .contentTransition(.numericText(value: Double(summary.remainingCents)))
            }

            HStack(spacing: 10) {
                metric("Income", Money.format(summary.incomeCents))
                metric("Planned", Money.format(summary.expenseCents))
                metric("Saved", Money.percent(summary.savingsRate))
            }
        }
        .foregroundStyle(.white)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.brand, in: .rect(cornerRadius: 28))
        .shadow(color: Color(hex: 0x765EFF).opacity(0.35), radius: 24, y: 12)
        .accessibilityElement(children: .combine)
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .opacity(0.8)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentTransition(.numericText())
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.16), in: .rect(cornerRadius: 16))
    }
}
