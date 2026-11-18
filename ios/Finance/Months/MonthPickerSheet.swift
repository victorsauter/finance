import FinanceKit
import SwiftUI

/// Year stepper and a 12-month grid. Any month of 2000-2200 can be opened,
/// with or without saved data; months that hold data carry a dot.
struct MonthPickerSheet: View {
    @Environment(BudgetStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var year: Int

    private static let labels = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]

    init(year: Int) {
        _year = State(initialValue: year)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                HStack {
                    Button("Previous year", systemImage: "chevron.left") { year -= 1 }
                        .disabled(year <= minBudgetYear)
                    Spacer()
                    Text(String(year))
                        .font(.title2.bold())
                        .monospacedDigit()
                        .contentTransition(.numericText(value: Double(year)))
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button("Next year", systemImage: "chevron.right") { year += 1 }
                        .disabled(year >= maxBudgetYear)
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
                .animation(.snappy, value: year)

                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3),
                    spacing: 10
                ) {
                    ForEach(1...12, id: \.self) { month in
                        cell(month)
                    }
                }

                Label("A dot marks months with saved data.", systemImage: "circle.fill")
                    .labelStyle(.titleAndIcon)
                    .imageScale(.small)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 0)
            }
            .padding(20)
            .navigationTitle("Choose a month")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("This month") {
                        let now = BudgetStore.currentMonth()
                        open(year: now.year, month: now.month)
                    }
                }
            }
        }
    }

    private func cell(_ month: Int) -> some View {
        let isSelected = store.selected == YearMonth(year: year, month: month)
        let isSaved = store.savedKeys.contains(monthKey(year: year, month: month))
        let isCurrent = BudgetStore.currentMonth() == YearMonth(year: year, month: month)

        return Button {
            open(year: year, month: month)
        } label: {
            VStack(spacing: 4) {
                Text(Self.labels[month - 1])
                    .font(.headline)
                Circle()
                    .fill(isSaved ? (isSelected ? Color.white : Theme.primary) : .clear)
                    .frame(width: 6, height: 6)
            }
            .foregroundStyle(isSelected ? Color.white : Color.primary)
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(
                isSelected ? AnyShapeStyle(Theme.primary) : AnyShapeStyle(Color(.secondarySystemFill)),
                in: .rect(cornerRadius: 16)
            )
            .overlay {
                if isCurrent {
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(Theme.primary, lineWidth: 2)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(getMonthName(year: year, month: month))
        .accessibilityValue(isSaved ? "Has saved data" : "No saved data")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func open(year: Int, month: Int) {
        withAnimation(.smooth) {
            store.select(year: year, month: month)
        }
        dismiss()
    }
}
