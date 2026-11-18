import CryptoKit
import Foundation

// The contract between the sync engine and the cloud. It mirrors
// `CloudTransport` in `src/data/cloud/types.ts`: one JSON document per user,
// written by compare-and-swap on an integer revision.

/// The cloud document and the revision it was read at.
public struct RemoteSnapshot: Equatable, Sendable {
    public var data: AppData
    public var revision: Int

    public init(data: AppData, revision: Int) {
        self.data = data
        self.revision = revision
    }
}

public enum RemoteSaveResult: Equatable, Sendable {
    /// The document is stored at this revision.
    case saved(revision: Int)
    /// The cloud is at another revision; nothing was written.
    case conflict(revision: Int)
}

/// Where the shared document lives. The Supabase implementation is in the app.
public protocol RemoteDocumentStore: Sendable {
    /// The cloud document, or nil when this account has none yet. Throws
    /// `RemoteDocumentError` when it exists but this app cannot read it.
    func fetch() async throws -> RemoteSnapshot?
    /// Saves when the cloud is still at `expectedRevision` (0 = no document).
    /// Saving twice with the same `mutationId` and document applies it once.
    func save(_ document: AppData, expectedRevision: Int, mutationId: UUID) async throws -> RemoteSaveResult
}

/// A cloud document this app must not touch.
public enum RemoteDocumentError: Error, Equatable, LocalizedError {
    case unsupportedSchema(Int)
    case invalidDocument(String)

    public var errorDescription: String? {
        switch self {
        case .unsupportedSchema(let version):
            "The cloud copy uses a newer format (version \(version)). Update the app to sync."
        case .invalidDocument(let reason):
            "The cloud copy could not be read: \(reason)"
        }
    }
}

/// Encoding shared by uploads, fingerprints and the round-trip fixture.
public enum DocumentCoding {
    public static func encode(_ data: AppData) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(data)
    }

    /// Decodes a document read from the cloud. A newer schema is reported as
    /// such before anything else, so it is never mistaken for a broken file.
    public static func decodeRemote(_ json: Data) throws(RemoteDocumentError) -> AppData {
        guard let object = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else {
            throw .invalidDocument("it is not a JSON object.")
        }
        if let version = object["schemaVersion"] as? Int, version > currentSchemaVersion {
            throw .unsupportedSchema(version)
        }
        let data: AppData
        do {
            data = try JSONDecoder().decode(AppData.self, from: json)
        } catch {
            throw .invalidDocument("it does not match the budget format.")
        }
        let issues = BackupFile.validate(data)
        guard issues.isEmpty else { throw .invalidDocument(issues.prefix(3).joined(separator: "; ")) }
        return data
    }

    /// A stable digest of a document's content, used as the durable dirty
    /// flag: local data is unsynced when its fingerprint differs from the one
    /// recorded at the last successful sync.
    public static func fingerprint(_ data: AppData) -> String {
        let bytes = (try? encode(data)) ?? Data()
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: Local sync state

/// A snapshot on its way to the cloud. Its id is kept until the server
/// acknowledges it, so a retry after a lost response is applied only once.
public struct PendingMutation: Codable, Equatable, Sendable {
    public var id: UUID
    public var document: AppData
    public var baseRevision: Int

    public init(id: UUID = UUID(), document: AppData, baseRevision: Int) {
        self.id = id
        self.document = document
        self.baseRevision = baseRevision
    }
}

/// Saved next to `budget.json`.
public struct SyncState: Codable, Equatable, Sendable {
    /// The account the local data is synced with; nil until the first sign-in
    /// has been settled.
    public var linkedUserId: String?
    /// Cloud revision of the last document read or written.
    public var revision: Int
    /// Fingerprint of the local data at that revision.
    public var syncedFingerprint: String?
    public var pending: PendingMutation?
    /// The cloud revision found when a save conflicted, until the user chooses.
    public var conflictRevision: Int?
    /// True while the local data is the sample seeded at first launch, never
    /// edited. Only then may a cloud copy replace it without asking.
    public var isUntouchedSample: Bool

    public init(
        linkedUserId: String? = nil, revision: Int = 0, syncedFingerprint: String? = nil,
        pending: PendingMutation? = nil, conflictRevision: Int? = nil, isUntouchedSample: Bool = false
    ) {
        self.linkedUserId = linkedUserId
        self.revision = revision
        self.syncedFingerprint = syncedFingerprint
        self.pending = pending
        self.conflictRevision = conflictRevision
        self.isUntouchedSample = isUntouchedSample
    }

    /// Forgets the link to the cloud, keeping nothing that could be pushed.
    mutating func unlink() {
        linkedUserId = nil
        revision = 0
        syncedFingerprint = nil
        pending = nil
        conflictRevision = nil
    }
}

public protocol SyncStateStore: Sendable {
    func load() async throws -> SyncState?
    func save(_ state: SyncState) async throws
}

public struct FileSyncStateStore: SyncStateStore {
    public let fileURL: URL

    public init(directory: URL? = nil, fileName: String = "sync.json") {
        let base = directory ?? URL.applicationSupportDirectory
            .appending(path: "Finance", directoryHint: .isDirectory)
        fileURL = base.appending(path: fileName, directoryHint: .notDirectory)
    }

    public func load() async throws -> SyncState? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try JSONDecoder().decode(SyncState.self, from: Data(contentsOf: fileURL))
    }

    public func save(_ state: SyncState) async throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        #if os(iOS)
        let options: Data.WritingOptions = [.atomic, .completeFileProtection]
        #else
        let options: Data.WritingOptions = [.atomic]
        #endif
        try JSONEncoder().encode(state).write(to: fileURL, options: options)
    }
}

public actor InMemorySyncStateStore: SyncStateStore {
    public private(set) var stored: SyncState?

    public init(_ initial: SyncState? = nil) { stored = initial }

    public func load() async throws -> SyncState? { stored }
    public func save(_ state: SyncState) async throws { stored = state }
}
