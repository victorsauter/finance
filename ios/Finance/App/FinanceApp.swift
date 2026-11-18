import SwiftUI

@main
struct FinanceApp: App {
    @State private var store = BudgetStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Theme.primary)
        }
    }
}

struct RootView: View {
    @Environment(BudgetStore.self) private var store
    @State private var isAddingExpense = false

    var body: some View {
        TabView {
            Tab("Budget", systemImage: "chart.pie.fill") {
                BudgetScreen()
            }
            Tab("Transactions", systemImage: "arrow.left.arrow.right") {
                PlaceholderScreen(title: "Transactions", symbol: "arrow.left.arrow.right")
            }
            Tab("Account", systemImage: "person.crop.circle") {
                PlaceholderScreen(title: "Account", symbol: "person.crop.circle")
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory {
            Button {
                isAddingExpense = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                        .foregroundStyle(Theme.primary)
                    Text("Add an expense")
                        .fontWeight(.medium)
                    Spacer()
                    Text(Money.format(store.month.summary.remainingCents))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
                .padding(.horizontal, 16)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
        .sheet(isPresented: $isAddingExpense) {
            AddExpenseSheet()
                .presentationDetents([.medium])
        }
    }
}

struct PlaceholderScreen: View {
    let title: String
    let symbol: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "Not in this prototype",
                systemImage: symbol,
                description: Text("Only the Budget tab is built.")
            )
            .navigationTitle(title)
        }
    }
}
