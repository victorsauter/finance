import Foundation

/// What the cloud copy holds, to describe it before the user chooses.
public struct CloudSummary: Equatable, Sendable {
    public var budgetMonths: Int
    public var transactions: Int
    public var revision: Int

    public init(budgetMonths: Int, transactions: Int, revision: Int) {
        self.budgetMonths = budgetMonths
        self.transactions = transactions
        self.revision = revision
    }

    init(_ snapshot: RemoteSnapshot) {
        self.init(
            budgetMonths: snapshot.data.budgetMonths.count,
            transactions: snapshot.data.importedTransactions.count,
            revision: snapshot.revision
        )
    }
}

public enum SyncStatus: Equatable, Sendable {
    /// No account: the app works on this iPhone only.
    case signedOut
    /// Reading the cloud for the first time with this account.
    case checking
    case syncing
    case synced
    /// Local changes wait for the next attempt (offline, or the last one failed).
    case unsynced(String?)
    /// Nothing waits, but the cloud cannot be reached.
    case offline
    /// The cloud could not be read; nothing local waits.
    case error(String)
    /// Signed in and the account has no cloud copy yet: the user may upload.
    case needsFirstUpload
    /// First sign-in: the cloud copy differs from data edited on this iPhone.
    case needsCloudChoice(CloudSummary)
    /// The cloud changed since this iPhone last synced, and both have edits.
    case conflict(CloudSummary?)
    /// The cloud copy cannot be read by this app: nothing is written.
    case blocked(String)

    /// The reason given with `unsynced` while there is no network.
    public static let offlineReason = "You are offline."
}

/// How the engine reads and replaces the document the screens edit.
public struct SyncLocalAccess: Sendable {
    public var read: @Sendable () async -> AppData
    /// Replaces the local document with `new` if it still equals `expected`
    /// (always when `expected` is nil), and returns whether it did. The check
    /// and the replacement must happen together, so an edit made while the
    /// cloud was being read is never overwritten.
    public var replace: @Sendable (_ new: AppData, _ expected: AppData?) async -> Bool

    public init(
        read: @escaping @Sendable () async -> AppData,
        replace: @escaping @Sendable (_ new: AppData, _ expected: AppData?) async -> Bool
    ) {
        self.read = read
        self.replace = replace
    }
}

/// Keeps the local document and the single cloud document in step, with the
/// rules of `CloudBudgetRepository` on the web:
/// - pull when nothing local is unsynced; push local changes otherwise;
/// - a push is a compare-and-swap on the revision, retried with the same
///   mutation id until acknowledged;
/// - a revision conflict waits for the user to keep one whole copy;
/// - a cloud copy this app cannot read is never written.
public actor SyncEngine {
    private let stateStore: any SyncStateStore
    private let local: SyncLocalAccess
    private let debounce: Duration
    private let onStatus: @Sendable (SyncStatus) async -> Void

    public private(set) var state = SyncState()
    public private(set) var status = SyncStatus.signedOut
    private var userId: String?
    private var remote: (any RemoteDocumentStore)?
    private var isOnline = true
    private var isRunning = false
    private var needsRerun = false
    private var debounceTask: Task<Void, Never>?

    public init(
        stateStore: any SyncStateStore,
        local: SyncLocalAccess,
        debounce: Duration = .seconds(2),
        onStatus: @escaping @Sendable (SyncStatus) async -> Void = { _ in }
    ) {
        self.stateStore = stateStore
        self.local = local
        self.debounce = debounce
        self.onStatus = onStatus
    }

    // MARK: Events

    /// Loads the saved state. `seededSample` is true when the local document
    /// was just created from sample data: any earlier link is then dropped,
    /// so sample data can never be pushed as if it were the user's edits.
    public func start(seededSample: Bool) async {
        state = (try? await stateStore.load()) ?? SyncState()
        if seededSample {
            state.unlink()
            state.isUntouchedSample = true
            await persist()
        }
    }

    public func signedIn(userId: String, remote: any RemoteDocumentStore) async {
        self.userId = userId
        self.remote = remote
        await sync()
    }

    /// Keeps the link and any pending change: signing in again with the same
    /// account resumes where it stopped.
    public func signedOut() async {
        userId = nil
        remote = nil
        debounceTask?.cancel()
        await publish(.signedOut)
    }

    public func setOnline(_ online: Bool) async {
        guard online != isOnline else { return }
        isOnline = online
        await sync()
    }

    /// Call after every user edit. Pushes after a short pause.
    public func localDidChange() async {
        if state.isUntouchedSample {
            state.isUntouchedSample = false
            await persist()
        }
        if case .synced = status { await publish(.unsynced(nil)) }
        scheduleSync()
    }

    /// The user reset this iPhone to sample data: it is no longer linked, so
    /// the sample is never uploaded; a later sync offers the cloud copy again.
    public func localDidResetToSample() async {
        state.unlink()
        state.isUntouchedSample = true
        await persist()
        scheduleSync()
    }

    // MARK: User choices

    /// Uploads this iPhone's copy over the cloud: after a conflict, on first
    /// sign-in when the cloud is empty, or when the user explicitly chose to
    /// replace the cloud copy.
    public func keepLocalCopy() async {
        guard let userId else { return }
        let base: Int
        switch status {
        case .needsFirstUpload: base = 0
        case .needsCloudChoice(let summary): base = summary.revision
        case .conflict: base = state.conflictRevision ?? state.revision
        default: return
        }
        let document = await local.read()
        state.linkedUserId = userId
        state.revision = base
        state.conflictRevision = nil
        state.pending = PendingMutation(document: document, baseRevision: base)
        state.isUntouchedSample = false
        await persist()
        await sync()
    }

    /// Replaces this iPhone's data with the cloud copy.
    public func useCloudCopy() async {
        guard let userId, let remote else { return }
        switch status {
        case .needsCloudChoice, .conflict: break
        default: return
        }
        await publish(.syncing)
        do {
            guard let snapshot = try await remote.fetch() else {
                await publish(.needsFirstUpload)
                return
            }
            guard self.userId == userId else { return }
            _ = await local.replace(snapshot.data, nil)
            await link(to: snapshot, userId: userId)
            await publish(.synced)
        } catch {
            await report(error, pendingChanges: true)
        }
    }

    // MARK: Sync

    /// Runs one sync now. Calls made while one runs are folded into a rerun.
    public func sync() async {
        if isRunning {
            needsRerun = true
            return
        }
        isRunning = true
        repeat {
            needsRerun = false
            await performSync()
        } while needsRerun && userId != nil
        isRunning = false
    }

    private func performSync() async {
        guard let userId, let remote else {
            await publish(.signedOut)
            return
        }
        let document = await local.read()
        let hasChanges = state.pending != nil || isDirty(document)
        guard isOnline else {
            let linked = state.linkedUserId == userId
            await publish(linked && hasChanges ? .unsynced(SyncStatus.offlineReason) : .offline)
            return
        }
        do {
            if state.linkedUserId != userId {
                try await firstLink(userId: userId, remote: remote)
            } else if state.conflictRevision != nil {
                let snapshot = try await remote.fetch()
                guard self.userId == userId else { return }
                await publish(.conflict(snapshot.map(CloudSummary.init)))
            } else {
                try await pushThenPull(userId: userId, remote: remote)
            }
        } catch {
            await report(error, pendingChanges: hasChanges && state.linkedUserId == userId)
        }
    }

    /// First sync with this account. Never writes to the cloud by itself.
    private func firstLink(userId: String, remote: any RemoteDocumentStore) async throws {
        await publish(.checking)
        let document = await local.read()
        let fetched = try await remote.fetch()
        guard self.userId == userId else { return }
        guard let snapshot = fetched else {
            await publish(.needsFirstUpload)
            return
        }
        if DocumentCoding.fingerprint(document) == DocumentCoding.fingerprint(snapshot.data) {
            await link(to: snapshot, userId: userId)
            await publish(.synced)
        } else if state.isUntouchedSample {
            if await local.replace(snapshot.data, document) {
                await link(to: snapshot, userId: userId)
                await publish(.synced)
            } else {
                needsRerun = true // edited meanwhile: ask on the next pass
            }
        } else {
            await publish(.needsCloudChoice(CloudSummary(snapshot)))
        }
    }

    private func pushThenPull(userId: String, remote: any RemoteDocumentStore) async throws {
        for _ in 0..<8 {
            let document = await local.read()
            if state.pending == nil {
                guard isDirty(document) else {
                    try await pull(expected: document, userId: userId, remote: remote)
                    return
                }
                let issues = BackupFile.validate(document)
                guard issues.isEmpty else {
                    await publish(.unsynced("The budget on this iPhone is invalid: \(issues[0])"))
                    return
                }
                state.pending = PendingMutation(document: document, baseRevision: state.revision)
                await persist()
            }
            guard let pending = state.pending else { continue }
            await publish(.syncing)
            let result = try await remote.save(
                pending.document, expectedRevision: pending.baseRevision, mutationId: pending.id
            )
            guard self.userId == userId, state.pending?.id == pending.id else { return }
            switch result {
            case .saved(let revision):
                state.revision = revision
                state.syncedFingerprint = DocumentCoding.fingerprint(pending.document)
                state.pending = nil
                await persist()
            case .conflict(let revision):
                // Reading the cloud first means an unreadable copy blocks
                // instead of being offered for overwrite.
                let snapshot = try await remote.fetch()
                guard self.userId == userId else { return }
                state.conflictRevision = snapshot?.revision ?? revision
                await persist()
                await publish(.conflict(snapshot.map(CloudSummary.init)))
                return
            }
        }
        await publish(.unsynced(nil))
    }

    private func pull(expected document: AppData, userId: String, remote: any RemoteDocumentStore) async throws {
        await publish(.syncing)
        let fetched = try await remote.fetch()
        guard self.userId == userId else { return }
        guard let snapshot = fetched else {
            // The cloud copy was deleted: uploading again is the user's call.
            await publish(.needsFirstUpload)
            return
        }
        if snapshot.revision != state.revision {
            guard await local.replace(snapshot.data, document) else {
                needsRerun = true // edited meanwhile: push it on the next pass
                return
            }
            state.revision = snapshot.revision
            state.syncedFingerprint = DocumentCoding.fingerprint(snapshot.data)
            await persist()
        }
        await publish(.synced)
    }

    // MARK: Helpers

    private func isDirty(_ document: AppData) -> Bool {
        DocumentCoding.fingerprint(document) != state.syncedFingerprint
    }

    private func link(to snapshot: RemoteSnapshot, userId: String) async {
        state.linkedUserId = userId
        state.revision = snapshot.revision
        state.syncedFingerprint = DocumentCoding.fingerprint(snapshot.data)
        state.pending = nil
        state.conflictRevision = nil
        state.isUntouchedSample = false
        await persist()
    }

    private func scheduleSync() {
        debounceTask?.cancel()
        let delay = debounce
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.sync()
        }
    }

    private func report(_ error: any Error, pendingChanges: Bool) async {
        if let error = error as? RemoteDocumentError {
            await publish(.blocked(error.localizedDescription))
        } else if pendingChanges {
            await publish(.unsynced(error.localizedDescription))
        } else {
            await publish(.error(error.localizedDescription))
        }
    }

    private func persist() async {
        try? await stateStore.save(state)
    }

    private func publish(_ next: SyncStatus) async {
        status = next
        await onStatus(next)
    }
}
