import FinanceKit
import Foundation
import Network
import Observation
import os
import Supabase

/// Account and cloud sync for the screens: email code sign-in through
/// Supabase Auth (session kept in the Keychain by supabase-swift) and the
/// FinanceKit `SyncEngine`, fed with app events (edits, foreground, network).
/// Signed out, the app keeps working on this iPhone's data only.
@Observable
final class SyncController {
    enum Account: Equatable {
        /// The build has no Supabase settings.
        case unavailable
        case signedOut
        case codeSent(email: String)
        case signedIn(email: String)
    }

    private(set) var account: Account
    private(set) var status = SyncStatus.signedOut
    private(set) var isWorking = false
    private(set) var lastSynced: Date?
    var authError: String?
    /// The user postponed the first sign-in choice; asked again on next change.
    var isDecisionPostponed = false

    @ObservationIgnored private let client: SupabaseClient?
    @ObservationIgnored private var engine: SyncEngine?
    @ObservationIgnored private var userId: UUID?
    @ObservationIgnored private var authTask: Task<Void, Never>?
    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private let log = Logger(subsystem: "dev.finance.prototype", category: "sync")

    init(store: BudgetStore, config: CloudConfig? = .fromBundle(), stateStore: any SyncStateStore = FileSyncStateStore()) {
        if let config {
            client = SupabaseClient(
                supabaseURL: config.url,
                supabaseKey: config.publishableKey,
                options: SupabaseClientOptions(auth: .init(emitLocalSessionAsInitialSession: true))
            )
            account = .signedOut
        } else {
            client = nil
            account = .unavailable
        }
        engine = SyncEngine(
            stateStore: stateStore,
            local: SyncLocalAccess(
                read: { @MainActor in store.data },
                replace: { @MainActor new, expected in store.applyRemote(new, ifCurrentIs: expected) }
            ),
            onStatus: { @MainActor [weak self] status in self?.didChange(status) }
        )
        store.onLocalEdit = { [weak self] in
            guard let engine = self?.engine else { return }
            Task { await engine.localDidChange() }
        }
        store.onResetToSample = { [weak self] in
            guard let engine = self?.engine else { return }
            Task { await engine.localDidResetToSample() }
        }
    }

    /// Loads the sync state, then follows the Supabase session and the network.
    func start(seededSample: Bool) async {
        guard let engine else { return }
        await engine.start(seededSample: seededSample)
        guard let client else { return }
        authTask = Task { [weak self] in
            for await (_, session) in client.auth.authStateChanges {
                await self?.sessionChanged(session)
            }
        }
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in await self?.engine?.setOnline(online) }
        }
        monitor.start(queue: .main)
    }

    /// Foreground, background: pull or push now rather than after the pause.
    func syncNow() {
        guard let engine, userId != nil else { return }
        Task { await engine.sync() }
    }

    // MARK: Sign-in

    func sendCode(to email: String) async {
        guard let client else { return }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        await perform {
            try await client.auth.signInWithOTP(email: address)
            account = .codeSent(email: address)
        }
    }

    func verify(code: String) async {
        guard let client, case .codeSent(let email) = account else { return }
        let token = code.filter { !$0.isWhitespace }
        await perform {
            _ = try await client.auth.verifyOTP(email: email, token: token, type: .email)
        }
    }

    func cancelCode() {
        authError = nil
        account = .signedOut
    }

    func signOut() async {
        guard let client else { return }
        await perform {
            try await client.auth.signOut(scope: .local)
        }
    }

    private func perform(_ work: () async throws -> Void) async {
        isWorking = true
        authError = nil
        defer { isWorking = false }
        do {
            try await work()
        } catch {
            authError = error.localizedDescription
        }
    }

    private func sessionChanged(_ session: Session?) async {
        guard let engine, let client else { return }
        guard let session else {
            userId = nil
            if case .codeSent = account { return }
            account = .signedOut
            await engine.signedOut()
            return
        }
        account = .signedIn(email: session.user.email ?? "Signed in")
        guard session.user.id != userId else { return }
        userId = session.user.id
        await engine.signedIn(
            userId: session.user.id.uuidString.lowercased(),
            remote: SupabaseDocumentStore(client: client, userId: session.user.id)
        )
    }

    // MARK: Choices

    func uploadThisIPhone() {
        guard let engine else { return }
        Task { await engine.keepLocalCopy() }
    }

    func useCloudCopy() {
        guard let engine else { return }
        Task { await engine.useCloudCopy() }
    }

    private func didChange(_ next: SyncStatus) {
        if next != status { isDecisionPostponed = false }
        if next == .synced { lastSynced = .now }
        if case .blocked(let reason) = next { log.error("Sync blocked: \(reason)") }
        status = next
    }
}

extension SyncController {
    /// A choice the user must make before sync can continue.
    enum Decision: Identifiable, Equatable {
        case firstSignIn(CloudSummary)
        case conflict(CloudSummary?)

        var id: String {
            switch self {
            case .firstSignIn: "first"
            case .conflict: "conflict"
            }
        }
    }

    var decision: Decision? {
        guard !isDecisionPostponed else { return nil }
        switch status {
        case .needsCloudChoice(let summary): return .firstSignIn(summary)
        case .conflict(let summary): return .conflict(summary)
        default: return nil
        }
    }

    var isSignedIn: Bool {
        if case .signedIn = account { true } else { false }
    }

    /// Short state for the Budget tab; nil when there is nothing to say.
    var badge: (text: String, symbol: String)? {
        guard isSignedIn else { return nil }
        switch status {
        case .unsynced(let reason) where reason == SyncStatus.offlineReason:
            return ("Offline · changes saved on this iPhone", "icloud.slash")
        case .unsynced: return ("Not synced yet", "arrow.trianglehead.2.clockwise.icloud")
        case .offline: return ("Offline", "icloud.slash")
        case .conflict, .needsCloudChoice: return ("Sync needs your choice", "exclamationmark.icloud")
        case .blocked, .error: return ("Sync problem", "exclamationmark.icloud")
        default: return nil
        }
    }

    /// One line for the Account tab.
    var statusText: String {
        switch status {
        case .signedOut: "Not signed in"
        case .checking: "Checking the cloud…"
        case .syncing: "Syncing…"
        case .synced: "Up to date"
        case .unsynced(let reason): reason.map { "Not synced yet. \($0)" } ?? "Changes waiting to sync"
        case .offline: "Offline"
        case .error(let message): "Could not sync. \(message)"
        case .needsFirstUpload: "No budget in the cloud yet"
        case .needsCloudChoice: "Choose which budget to keep"
        case .conflict: "The cloud copy changed too. Choose which copy to keep."
        case .blocked(let message): "Sync paused, nothing is written. \(message)"
        }
    }

    var statusSymbol: String {
        switch status {
        case .synced: "checkmark.icloud"
        case .syncing, .checking: "arrow.trianglehead.2.clockwise.icloud"
        case .unsynced, .needsFirstUpload: "icloud.and.arrow.up"
        case .offline: "icloud.slash"
        case .signedOut: "icloud"
        case .error, .blocked, .conflict, .needsCloudChoice: "exclamationmark.icloud"
        }
    }
}
