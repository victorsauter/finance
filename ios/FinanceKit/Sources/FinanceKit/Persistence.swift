import Foundation

/// Where the budget document lives. Screens depend on this, not on files, so
/// the sync engine can replace the storage later.
public protocol BudgetRepository: Sendable {
    /// The stored document, or nil when nothing has been saved yet.
    func load() async throws -> AppData?
    func save(_ data: AppData) async throws
    func clear() async throws
}

/// One JSON file in Application Support, written atomically.
public struct FileBudgetRepository: BudgetRepository {
    public let fileURL: URL

    /// - Parameter directory: Where `budget.json` goes. Defaults to a
    ///   `Finance` folder in Application Support; tests pass a temp folder.
    public init(directory: URL? = nil, fileName: String = "budget.json") {
        let base = directory ?? URL.applicationSupportDirectory
            .appending(path: "Finance", directoryHint: .isDirectory)
        self.fileURL = base.appending(path: fileName, directoryHint: .notDirectory)
    }

    public func load() async throws -> AppData? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode(AppData.self, from: data)
    }

    public func save(_ data: AppData) async throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let encoded = try encoder.encode(data)
        #if os(iOS)
        let options: Data.WritingOptions = [.atomic, .completeFileProtection]
        #else
        let options: Data.WritingOptions = [.atomic]
        #endif
        try encoded.write(to: fileURL, options: options)
    }

    public func clear() async throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}

/// Keeps the document in memory. For previews and tests.
public actor InMemoryBudgetRepository: BudgetRepository {
    private var stored: AppData?

    public init(_ initial: AppData? = nil) {
        stored = initial
    }

    public func load() async throws -> AppData? { stored }
    public func save(_ data: AppData) async throws { stored = data }
    public func clear() async throws { stored = nil }
}
