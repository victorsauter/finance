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
    }
}
