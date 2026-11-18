import Charts
import SwiftUI

/// Donut of where the month's income goes. Touch a slice to read it.
struct AllocationCard: View {
    let month: BudgetMonth
    @Binding var selection: ExpenseCategory.ID?
    @State private var touchedAmount: Int?

    private struct Slice: Identifiable {
        let id: UUID
        let name: String
        let cents: Int
        let color: Color
    }

    private static let leftoverID = UUID()

    private var slices: [Slice] {
        var result = month.categories.enumerated().map { index, category in
            Slice(
                id: category.id, name: category.name,
                cents: category.totalCents, color: Theme.categoryColor(at: index)
            )
        }
        let remaining = month.summary.remainingCents
        if remaining > 0 {
            result.append(
                Slice(id: Self.leftoverID, name: "Left", cents: remaining, color: Theme.saving)
            )
        }
        return result.filter { $0.cents > 0 }
    }

    var body: some View {
        let slices = slices
        let selected = slices.first { $0.id == selection }

        VStack(alignment: .leading, spacing: 12) {
            Text("Where it goes")
                .font(.headline)

            Chart(slices) { slice in
                SectorMark(
                    angle: .value("Amount", slice.cents),
                    innerRadius: .ratio(0.66),
                    angularInset: 2
                )
                .cornerRadius(7)
                .foregroundStyle(slice.color)
                .opacity(selected == nil || selected?.id == slice.id ? 1 : 0.3)
            }
            .chartLegend(.hidden)
            .chartAngleSelection(value: $touchedAmount)
            // The built-in selection needs a short hold inside a scroll view;
            // this makes a plain tap select too, and a second tap clear.
            .chartGesture { proxy in
                SpatialTapGesture().onEnded { tap in
                    let angle = proxy.angle(at: tap.location)
                    guard let amount = proxy.value(atAngle: angle, as: Int.self)
                    else { return }
                    let tapped = slice(at: amount, in: slices)?.id
                    withAnimation(.snappy) {
                        selection = tapped == Self.leftoverID || tapped == selection ? nil : tapped
                    }
                }
            }
            .chartBackground { _ in
                VStack(spacing: 2) {
                    Text(selected?.name ?? "Planned")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(Money.format(selected?.cents ?? month.summary.expenseCents))
                        .font(.title2.bold())
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }
            }
            .frame(height: 220)
            .sensoryFeedback(.selection, trigger: selection)
        }
        .padding(20)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 28))
        .onChange(of: touchedAmount) { _, amount in
            guard let amount else { return }
            let touched = slice(at: amount, in: slices)?.id
            withAnimation(.snappy) {
                selection = touched == Self.leftoverID ? nil : touched
            }
        }
    }

    /// The slice whose cumulative range contains `amount`.
    private func slice(at amount: Int, in slices: [Slice]) -> Slice? {
        var upperBound = 0
        for slice in slices {
            upperBound += slice.cents
            if amount <= upperBound { return slice }
        }
        return slices.last
    }
}
