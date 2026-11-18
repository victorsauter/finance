import FinanceKit
import SwiftUI

@main
struct FinanceApp: App {
    private enum Phase {
        case loading
        case ready(BudgetStore)
        case failed(String)
    }

    private let repository = FileBudgetRepository()
    @State private var phase = Phase.loading

    var body: some Scene {
        WindowGroup {
            Group {
                switch phase {
                case .loading:
                    ProgressView()
                case .ready(let store):
                    RootView()
                        .environment(store)
                case .failed(let message):
                    ContentUnavailableView {
                        Label("Could not open your budget", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try again") { Task { await load() } }
                        Button("Erase local data", role: .destructive) {
                            Task { await erase() }
                        }
                    }
                }
            }
            .tint(Theme.primary)
            .task { await load() }
        }
    }

    private func load() async {
        phase = .loading
        do {
            phase = .ready(try await BudgetStore.load(from: repository))
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func erase() async {
        try? await repository.clear()
        await load()
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
