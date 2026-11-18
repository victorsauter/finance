import FinanceKit
import SwiftUI

@main
struct FinanceApp: App {
    private enum Phase {
        case loading
        case ready(BudgetStore, SyncController)
        case failed(String)
    }

    private let repository = FileBudgetRepository()
    @State private var phase = Phase.loading
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                switch phase {
                case .loading:
                    ProgressView()
                case .ready(let store, let sync):
                    RootView()
                        .environment(store)
                        .environment(sync)
                        .onChange(of: scenePhase) { _, phase in
                            // Pull on return, push before the app is suspended.
                            if phase != .inactive { sync.syncNow() }
                        }
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
            let store = try await BudgetStore.load(from: repository)
            let sync = SyncController(store: store)
            await sync.start(seededSample: store.seededSample)
            phase = .ready(store, sync)
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
    @Environment(SyncController.self) private var sync

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
        .sheet(item: Binding(
            get: { sync.decision },
            set: { if $0 == nil { sync.isDecisionPostponed = true } }
        )) { decision in
            SyncDecisionSheet(decision: decision)
        }
    }
}
