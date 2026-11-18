import Foundation
import Testing
@testable import FinanceKit

private struct NetworkDown: Error {}

/// Behaves like `save_finance_document`: compare-and-swap on the revision and
/// idempotency receipts per mutation id.
private actor FakeCloud: RemoteDocumentStore {
    var document: AppData?
    var revision = 0
    /// Raw JSON returned instead of `document`, to test unreadable copies.
    var rawJSON: Data?
    var receipts: [UUID: Int] = [:]
    var saveCalls: [UUID] = []
    var appliedSaves = 0
    var failNextSave = false
    var loseNextResponse = false

    init(document: AppData? = nil, revision: Int = 0) {
        self.document = document
        self.revision = document == nil ? 0 : max(revision, 1)
    }

    func set(_ data: AppData?, revision: Int) {
        document = data
        self.revision = revision
    }

    func setRaw(_ json: Data, revision: Int) {
        rawJSON = json
        self.revision = revision
    }

    func failNext() { failNextSave = true }
    func loseNext() { loseNextResponse = true }

    func fetch() async throws -> RemoteSnapshot? {
        if let rawJSON { return RemoteSnapshot(data: try DocumentCoding.decodeRemote(rawJSON), revision: revision) }
        return document.map { RemoteSnapshot(data: $0, revision: revision) }
    }

    func save(_ document: AppData, expectedRevision: Int, mutationId: UUID) async throws -> RemoteSaveResult {
        saveCalls.append(mutationId)
        if failNextSave {
            failNextSave = false
            throw NetworkDown()
        }
        if let receipt = receipts[mutationId] { return .saved(revision: receipt) }
        guard expectedRevision == revision else { return .conflict(revision: revision) }
        revision += 1
        self.document = document
        rawJSON = nil
        receipts[mutationId] = revision
        appliedSaves += 1
        if loseNextResponse {
            loseNextResponse = false
            throw NetworkDown()
        }
        return .saved(revision: revision)
    }
}

/// The document the screens edit.
private actor LocalDocument {
    var data: AppData
    init(_ data: AppData) { self.data = data }
    func edit(_ change: (inout AppData) -> Void) { change(&data) }
    func replace(_ new: AppData, expected: AppData?) -> Bool {
        if let expected, expected != data { return false }
        data = new
        return true
    }

    nonisolated var access: SyncLocalAccess {
        SyncLocalAccess(
            read: { await self.data },
            replace: { new, expected in await self.replace(new, expected: expected) }
        )
    }
}

private func fixture() throws -> AppData {
    try JSONDecoder().decode(AppData.self, from: Fixtures.appDataJSON("app-data"))
}

private func renamed(_ data: AppData, _ name: String) -> AppData {
    var copy = data
    copy.budgetMonths[0].incomes[0].name = name
    return copy
}

private func makeEngine(
    _ local: LocalDocument, store: InMemorySyncStateStore = InMemorySyncStateStore()
) -> SyncEngine {
    SyncEngine(stateStore: store, local: local.access, debounce: .seconds(3600))
}

@Suite struct SyncEngineTests {
    // MARK: First sign-in

    @Test func emptyCloudOffersUploadAndWritesNothingUntilAsked() async throws {
        let local = LocalDocument(try fixture())
        let cloud = FakeCloud()
        let engine = makeEngine(local)
        await engine.start(seededSample: false)

        await engine.signedIn(userId: "user", remote: cloud)
        #expect(await engine.status == .needsFirstUpload)
        #expect(await cloud.saveCalls.isEmpty)

        await engine.keepLocalCopy()
        #expect(await engine.status == .synced)
        #expect(await cloud.document == local.data)
        #expect(await cloud.revision == 1)
    }

    @Test func untouchedSampleIsReplacedByTheCloudWithoutUploading() async throws {
        let sample = renamed(try fixture(), "Sample salary")
        let real = try fixture()
        let local = LocalDocument(sample)
        let cloud = FakeCloud(document: real, revision: 7)
        let engine = makeEngine(local)
        await engine.start(seededSample: true)

        await engine.signedIn(userId: "user", remote: cloud)
        #expect(await engine.status == .synced)
        #expect(await local.data == real)
        #expect(await cloud.saveCalls.isEmpty)
        #expect(await engine.state.revision == 7)
    }

    @Test func editedLocalDataAsksBeforeUsingTheCloud() async throws {
        let mine = renamed(try fixture(), "Edited on the iPhone")
        let real = try fixture()
        let local = LocalDocument(mine)
        let cloud = FakeCloud(document: real, revision: 3)
        let engine = makeEngine(local)
        await engine.start(seededSample: false) // e.g. data from before sync existed

        await engine.signedIn(userId: "user", remote: cloud)
        #expect(await engine.status == .needsCloudChoice(
            CloudSummary(budgetMonths: real.budgetMonths.count, transactions: 2, revision: 3)
        ))
        #expect(await local.data == mine)
        #expect(await cloud.saveCalls.isEmpty)

        // Deciding later and coming back asks again; still nothing written.
        await engine.sync()
        #expect(await cloud.saveCalls.isEmpty)

        await engine.useCloudCopy()
        #expect(await engine.status == .synced)
        #expect(await local.data == real)
        #expect(await cloud.saveCalls.isEmpty)
    }

    @Test func sampleEditedOnceIsNoLongerUntouched() async throws {
        let local = LocalDocument(renamed(try fixture(), "Sample salary"))
        let cloud = FakeCloud(document: try fixture(), revision: 2)
        let engine = makeEngine(local)
        await engine.start(seededSample: true)
        await local.edit { $0.budgetMonths[0].name = "My month" }
        await engine.localDidChange()

        await engine.signedIn(userId: "user", remote: cloud)
        guard case .needsCloudChoice = await engine.status else {
            Issue.record("Expected a choice, got \(await engine.status)")
            return
        }
        #expect(await cloud.saveCalls.isEmpty)
    }

    @Test func explicitChoiceCanReplaceTheCloudCopy() async throws {
        let mine = renamed(try fixture(), "Edited on the iPhone")
        let local = LocalDocument(mine)
        let cloud = FakeCloud(document: try fixture(), revision: 3)
        let engine = makeEngine(local)
        await engine.start(seededSample: false)
        await engine.signedIn(userId: "user", remote: cloud)

        await engine.keepLocalCopy()
        #expect(await engine.status == .synced)
        #expect(await cloud.document == mine)
        #expect(await cloud.revision == 4)
    }

    @Test func newerCloudSchemaBlocksAndWritesNothing() async throws {
        let original = try fixture()
        let local = LocalDocument(original)
        let cloud = FakeCloud()
        var raw = try JSONSerialization.jsonObject(with: Fixtures.appDataJSON("app-data")) as! [String: Any]
        raw["schemaVersion"] = currentSchemaVersion + 1
        await cloud.setRaw(try JSONSerialization.data(withJSONObject: raw), revision: 5)
        let engine = makeEngine(local)
        await engine.start(seededSample: true)

        await engine.signedIn(userId: "user", remote: cloud)
        guard case .blocked = await engine.status else {
            Issue.record("Expected blocked, got \(await engine.status)")
            return
        }
        #expect(await local.data == original)
        #expect(await cloud.saveCalls.isEmpty)
        // The user cannot force an upload from that state.
        await engine.keepLocalCopy()
        #expect(await cloud.saveCalls.isEmpty)
    }

    @Test func unreadableCloudCopyBlocksALinkedDeviceToo() async throws {
        let local = LocalDocument(try fixture())
        let cloud = FakeCloud(document: try fixture(), revision: 1)
        let engine = makeEngine(local)
        await engine.start(seededSample: false)
        await engine.signedIn(userId: "user", remote: cloud)
        #expect(await engine.status == .synced)

        // A newer web version rewrites the document; this iPhone has an edit.
        await cloud.setRaw(Data(#"{"schemaVersion": 2, "settings": 1}"#.utf8), revision: 2)
        await local.edit { $0.budgetMonths[0].name = "Edited" }
        await engine.sync()
        guard case .blocked = await engine.status else {
            Issue.record("Expected blocked, got \(await engine.status)")
            return
        }
        #expect(await cloud.appliedSaves == 0)
    }

    // MARK: Pushing and pulling

    private func linked(_ data: AppData, store: InMemorySyncStateStore = InMemorySyncStateStore())
        async throws -> (LocalDocument, FakeCloud, SyncEngine)
    {
        let local = LocalDocument(data)
        let cloud = FakeCloud(document: data, revision: 1)
        let engine = makeEngine(local, store: store)
        await engine.start(seededSample: false)
        await engine.signedIn(userId: "user", remote: cloud)
        #expect(await engine.status == .synced)
        return (local, cloud, engine)
    }

    @Test func editsArePushed() async throws {
        let (local, cloud, engine) = try await linked(try fixture())
        await local.edit { $0.budgetMonths[0].name = "Edited" }
        await engine.localDidChange()
        #expect(await engine.status == .unsynced(nil))

        await engine.sync()
        #expect(await engine.status == .synced)
        #expect(await cloud.document == local.data)
        #expect(await cloud.revision == 2)
    }

    @Test func lostResponseIsRetriedWithTheSameMutationAndAppliedOnce() async throws {
        let store = InMemorySyncStateStore()
        let (local, cloud, engine) = try await linked(try fixture(), store: store)
        await local.edit { $0.budgetMonths[0].name = "Edited" }
        await cloud.loseNext()
        await engine.sync()
        guard case .unsynced = await engine.status else {
            Issue.record("Expected unsynced, got \(await engine.status)")
            return
        }
        let pending = try #require(await store.stored?.pending)

        // Relaunch: a new engine reads the saved state and retries.
        let relaunched = makeEngine(local, store: store)
        await relaunched.start(seededSample: false)
        await relaunched.signedIn(userId: "user", remote: cloud)
        #expect(await relaunched.status == .synced)
        #expect(await cloud.saveCalls == [pending.id, pending.id])
        #expect(await cloud.appliedSaves == 1)
        #expect(await cloud.revision == 2)
        #expect(await relaunched.state.revision == 2)
    }

    @Test func offlineKeepsChangesUntilTheNetworkReturns() async throws {
        let (local, cloud, engine) = try await linked(try fixture())
        await engine.setOnline(false)
        await local.edit { $0.budgetMonths[0].name = "Edited offline" }
        await engine.sync()
        #expect(await engine.status == .unsynced("You are offline."))
        #expect(await cloud.saveCalls.isEmpty)

        await engine.setOnline(true)
        #expect(await engine.status == .synced)
        #expect(await cloud.document == local.data)
    }

    @Test func failedSaveStaysUnsyncedAndRetries() async throws {
        let (local, cloud, engine) = try await linked(try fixture())
        await local.edit { $0.budgetMonths[0].name = "Edited" }
        await cloud.failNext()
        await engine.sync()
        guard case .unsynced = await engine.status else {
            Issue.record("Expected unsynced, got \(await engine.status)")
            return
        }
        await engine.sync()
        #expect(await engine.status == .synced)
        #expect(await cloud.document == local.data)
    }

    @Test func cloudChangesArePulledWhenNothingIsDirty() async throws {
        let (local, cloud, engine) = try await linked(try fixture())
        let fromWeb = renamed(try fixture(), "Edited on the web")
        await cloud.set(fromWeb, revision: 2)
        await engine.sync()
        #expect(await engine.status == .synced)
        #expect(await local.data == fromWeb)
        #expect(await cloud.saveCalls.isEmpty)
    }

    @Test func conflictKeepsThisIPhone() async throws {
        let (local, cloud, engine) = try await linked(try fixture())
        await cloud.set(renamed(try fixture(), "Edited on the web"), revision: 2)
        await local.edit { $0.budgetMonths[0].name = "Edited on the iPhone" }
        await engine.sync()
        guard case .conflict(let summary) = await engine.status else {
            Issue.record("Expected a conflict, got \(await engine.status)")
            return
        }
        #expect(summary?.revision == 2)
        #expect(await cloud.appliedSaves == 0)

        await engine.keepLocalCopy()
        #expect(await engine.status == .synced)
        #expect(await cloud.document == local.data)
        #expect(await cloud.revision == 3)
    }

    @Test func conflictKeepsTheCloud() async throws {
        let (local, cloud, engine) = try await linked(try fixture())
        let fromWeb = renamed(try fixture(), "Edited on the web")
        await cloud.set(fromWeb, revision: 2)
        await local.edit { $0.budgetMonths[0].name = "Edited on the iPhone" }
        await engine.sync()

        await engine.useCloudCopy()
        #expect(await engine.status == .synced)
        #expect(await local.data == fromWeb)
        #expect(await cloud.appliedSaves == 0)
        // Nothing left to push.
        await engine.sync()
        #expect(await cloud.appliedSaves == 0)
    }

    @Test func conflictSurvivesARelaunch() async throws {
        let store = InMemorySyncStateStore()
        let (local, cloud, engine) = try await linked(try fixture(), store: store)
        await cloud.set(renamed(try fixture(), "Edited on the web"), revision: 2)
        await local.edit { $0.budgetMonths[0].name = "Edited on the iPhone" }
        await engine.sync()

        let relaunched = makeEngine(local, store: store)
        await relaunched.start(seededSample: false)
        await relaunched.signedIn(userId: "user", remote: cloud)
        guard case .conflict = await relaunched.status else {
            Issue.record("Expected a conflict, got \(await relaunched.status)")
            return
        }
        #expect(await cloud.appliedSaves == 0)
    }

    // MARK: Sample data safety

    @Test func reseededSampleIsNeverPushedOverALinkedCloud() async throws {
        let store = InMemorySyncStateStore()
        let real = try fixture()
        let (_, cloud, _) = try await linked(real, store: store)

        // Local data erased and reseeded with sample data on next launch.
        let sample = LocalDocument(renamed(real, "Sample salary"))
        let relaunched = makeEngine(sample, store: store)
        await relaunched.start(seededSample: true)
        await relaunched.signedIn(userId: "user", remote: cloud)
        #expect(await cloud.appliedSaves == 0)
        #expect(await sample.data == real)
    }

    @Test func resetToSampleUnlinksAndNeverUploads() async throws {
        let real = try fixture()
        let (local, cloud, engine) = try await linked(real)
        await local.edit { $0 = renamed(real, "Sample salary") }
        await engine.localDidResetToSample()
        await engine.sync()
        #expect(await cloud.appliedSaves == 0)
        #expect(await local.data == real)
    }

    @Test func anotherAccountGoesThroughTheFirstSignInRules() async throws {
        let (local, cloud, engine) = try await linked(try fixture())
        await engine.signedOut()
        #expect(await engine.status == .signedOut)
        await local.edit { $0.budgetMonths[0].name = "Edited" }

        let other = FakeCloud(document: renamed(try fixture(), "Other"), revision: 4)
        await engine.signedIn(userId: "someone-else", remote: other)
        guard case .needsCloudChoice = await engine.status else {
            Issue.record("Expected a choice, got \(await engine.status)")
            return
        }
        #expect(await other.saveCalls.isEmpty)
        #expect(await cloud.saveCalls.isEmpty)
    }
}
