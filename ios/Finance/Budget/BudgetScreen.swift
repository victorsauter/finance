import FinanceKit
import SwiftUI

struct BudgetScreen: View {
    @Environment(BudgetStore.self) private var store
    @State private var expanded: Set<ExpenseCategory.ID> = []
    @State private var selectedCategory: ExpenseCategory.ID?

    var body: some View {
        let month = store.month
        let summary = month.summary

        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 16) {
                    SummaryCard(summary: summary)
                    AllocationCard(month: month, selection: $selectedCategory)

                    HStack(alignment: .firstTextBaseline) {
                        Text("Planned expenses")
                            .font(.title3.bold())
                        Spacer()
                        Text(Money.format(summary.expenseCents))
                            .font(.subheadline)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .contentTransition(.numericText())
                    }
                    .padding(.top, 8)
                    .padding(.horizontal, 4)

                    ForEach(Array(month.expenseCategories.enumerated()), id: \.element.id) { index, category in
                        CategoryCard(
                            category: category,
                            symbol: CategorySymbol.symbol(for: category, at: index),
                            color: Theme.categoryColor(at: index),
                            incomeCents: summary.incomeCents,
                            isExpanded: expanded.contains(category.id),
                            isHighlighted: selectedCategory == category.id
                        ) {
                            withAnimation(.snappy) {
                                if !expanded.insert(category.id).inserted {
                                    expanded.remove(category.id)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(PageBackground())
            .navigationTitle(month.name)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Previous month", systemImage: "chevron.left") { step(-1) }
                        .disabled(!store.hasPrevious)
                    Button("Next month", systemImage: "chevron.right") { step(1) }
                        .disabled(!store.hasNext)
                }
            }
            .sensoryFeedback(.selection, trigger: month.id)
            .sensoryFeedback(.impact(weight: .light), trigger: expanded)
        }
    }

    private func step(_ delta: Int) {
        withAnimation(.smooth) {
            selectedCategory = nil
            store.step(delta)
        }
    }
}

#Preview {
    BudgetScreen()
        .environment(BudgetStore(
            data: SampleData.appData(),
            repository: InMemoryBudgetRepository()
        ))
}
