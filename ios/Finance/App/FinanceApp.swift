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
                TransactionsScreen()
            }
            Tab("Account", systemImage: "person.crop.circle") {
                AccountScreen()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory {
            AddExpenseAccessory { isAddingExpense = true }
        }
        .sheet(isPresented: $isAddingExpense) {
            AddExpenseSheet()
                .presentationDetents([.medium])
        }
    }
}

/// The bar above the tabs. Next to a minimised tab bar there is only room
/// for the icon and the amount, so the label drops out when it does not fit.
private struct AddExpenseAccessory: View {
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
