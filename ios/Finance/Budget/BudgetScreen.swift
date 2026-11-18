import FinanceKit
import SwiftUI

struct BudgetScreen: View {
    @Environment(BudgetStore.self) private var store
    @State private var expanded: Set<ExpenseCategory.ID> = []
    @State private var selectedCategory: ExpenseCategory.ID?
    @State private var isPickingMonth = false
    @State private var isConfirmingReset = false

    var body: some View {
        let month = store.month
        let summary = month.summary

        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 16) {
                    if store.isVirtual {
                        VirtualMonthNotice(sourceName: store.seedSourceName)
                    }
                    SummaryCard(summary: summary)
                    AllocationCard(month: month, selection: $selectedCategory)

                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Planned expenses")
                                .font(.title3.bold())
                            Text(Money.format(summary.expenseCents))
                                .font(.subheadline)
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                                .contentTransition(.numericText())
                        }
                        Spacer(minLength: 8)
                        NavigationLink {
                            EditPlanScreen()
                        } label: {
                            Label("Edit plan", systemImage: "slider.horizontal.3")
                                .font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(.glass)
                    }
                    .padding(.top, 8)
                    .padding(.horizontal, 4)

                    if month.expenseCategories.isEmpty {
                        ContentUnavailableView(
                            "No categories",
                            systemImage: "tag",
                            description: Text("Open Edit plan to add the categories you spend on.")
                        )
                    }

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
            .scrollEdgeEffectStyle(.hard, for: .top)
            .navigationTitle(month.name)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu("More", systemImage: "ellipsis") {
                        NavigationLink {
                            EditPlanScreen()
                        } label: {
                            Label("Edit plan", systemImage: "slider.horizontal.3")
                        }
                        Button("Reset month", systemImage: "arrow.counterclockwise", role: .destructive) {
                            isConfirmingReset = true
                        }
                    }
                }
                MonthToolbar(isPickingMonth: $isPickingMonth)
            }
            .monthPickerSheet(isPresented: $isPickingMonth)
            .resetMonthDialog(isPresented: $isConfirmingReset)
            .onChange(of: store.selected) { selectedCategory = nil }
            .sensoryFeedback(.selection, trigger: store.selected)
            .sensoryFeedback(.impact(weight: .light), trigger: expanded)
        }
    }
}

/// Shown for a month that exists only on screen until its first edit.
private struct VirtualMonthNotice: View {
    let sourceName: String?

    var body: some View {
        Label {
            Text(sourceName.map { "Planned from \($0). Saved when you make a first change." }
                ?? "An empty plan. Saved when you make a first change.")
        } icon: {
            Image(systemName: "doc.badge.clock")
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
}

#Preview {
    BudgetScreen()
        .environment(BudgetStore(
            data: SampleData.appData(),
            repository: InMemoryBudgetRepository()
        ))
}
