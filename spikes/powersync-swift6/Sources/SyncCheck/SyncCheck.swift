import Foundation
import Observation
import PowerSync

// Same file is used (copied) in both targets; only the isolation default differs.

// MARK: Schema

let checkSchema = Schema(tables: [
    Table(name: "budget_months", columns: [
        .text("label"),
        .integer("year"),
        .integer("month"),
    ]),
    Table(name: "budget_incomes", columns: [
        .text("month_id"),
        .text("name"),
        .integer("amount_cents"),
    ]),
])

// MARK: Connector

/// Plain final class: the protocol requires `Sendable`, so a class conformer must be immutable.
final class DummyConnector: PowerSyncBackendConnectorProtocol {
    func fetchCredentials() async throws -> PowerSyncCredentials? {
        PowerSyncCredentials(endpoint: "https://example.invalid", token: "dummy")
    }

    func uploadData(database: PowerSyncDatabaseProtocol) async throws {
        guard let transaction = try await database.getNextCrudTransaction() else { return }
        for entry in transaction.crud {
            _ = (entry.table, entry.id, entry.op, entry.opDataTyped)
        }
        try await transaction.complete()
        // Batch variant
        if let batch = try await database.getCrudBatch(limit: 50) {
            for entry in batch.crud { _ = entry.clientId }
            try await batch.complete()
        }
    }
}

/// Connector conformer isolated to an actor: tests whether the protocol's `Sendable` + nonisolated
/// async requirements accept an actor.
actor ActorConnector: PowerSyncBackendConnectorProtocol {
    private var uploads = 0
    func fetchCredentials() async throws -> PowerSyncCredentials? {
        PowerSyncCredentials(endpoint: "https://example.invalid", token: "dummy")
    }
    func uploadData(database: PowerSyncDatabaseProtocol) async throws {
        uploads += 1
        if let tx = try await database.getNextCrudTransaction() { try await tx.complete() }
    }
}

/// Connector conformer isolated to the main actor.
@MainActor
final class MainActorConnector: PowerSyncBackendConnectorProtocol {
    func fetchCredentials() async throws -> PowerSyncCredentials? {
        PowerSyncCredentials(endpoint: "https://example.invalid", token: "dummy")
    }
    func uploadData(database: PowerSyncDatabaseProtocol) async throws {
        if let tx = try await database.getNextCrudTransaction() { try await tx.complete() }
    }
}

// MARK: Model

struct BudgetIncome: Sendable, Equatable {
    let id: String
    let name: String
    let amountCents: Int
}

// MARK: Database access

func openCheckDatabase() -> any PowerSyncDatabaseProtocol {
    PowerSyncDatabase(schema: checkSchema, dbFilename: ":memory:")
}

/// Database passed across an actor boundary.
actor DatabaseHolder {
    private let database: any PowerSyncDatabaseProtocol
    init(database: any PowerSyncDatabaseProtocol) { self.database = database }

    func insertIncome(name: String, cents: Int) async throws {
        let id = UUID().uuidString
        try await database.writeTransaction { tx in
            _ = try tx.execute(
                sql: "INSERT INTO budget_incomes (id, month_id, name, amount_cents) VALUES (?, ?, ?, ?)",
                parameters: [id, "m1", name, cents]
            )
        }
    }

    func incomes() async throws -> [BudgetIncome] {
        try await database.getAll(sql: "SELECT id, name, amount_cents FROM budget_incomes", parameters: []) { cursor in
            BudgetIncome(
                id: try cursor.getString(index: 0),
                name: try cursor.getString(index: 1),
                amountCents: try cursor.getInt(index: 2)
            )
        }
    }

    func connect() async throws {
        try await database.connect(connector: DummyConnector(), options: nil)
    }

    func connectWithActorConnector() async throws {
        try await database.connect(connector: ActorConnector(), options: nil)
    }

    func raw() -> any PowerSyncDatabaseProtocol { database }
}

// MARK: Store (what a SwiftUI store would look like)

@MainActor
@Observable
final class BudgetStore {
    private(set) var incomes: [BudgetIncome] = []
    private(set) var connected = false
    private(set) var lastError: String?

    private let database: any PowerSyncDatabaseProtocol
    private let holder: DatabaseHolder
    private var watchTask: Task<Void, Never>?
    private var statusTask: Task<Void, Never>?

    init(database: any PowerSyncDatabaseProtocol) {
        self.database = database
        self.holder = DatabaseHolder(database: database)
    }

    func start() {
        watchTask = Task { [database] in
            do {
                let stream = try database.watch(
                    "SELECT id, name, amount_cents FROM budget_incomes ORDER BY name"
                ) { cursor in
                    BudgetIncome(
                        id: try cursor.getString(index: 0),
                        name: try cursor.getString(index: 1),
                        amountCents: try cursor.getInt(index: 2)
                    )
                }
                for try await rows in stream {
                    self.incomes = rows
                }
            } catch {
                self.lastError = String(describing: error)
            }
        }

        statusTask = Task { [database] in
            for await status in database.currentStatus.asFlow() {
                self.connected = status.connected
            }
        }
    }

    func readStatusSnapshot() -> Bool {
        let status = database.currentStatus
        return status.connected || status.connecting || status.uploading || status.hasSynced == true
    }

    func add(name: String, cents: Int) {
        Task {
            do { try await holder.insertIncome(name: name, cents: cents) }
            catch { lastError = String(describing: error) }
        }
    }

    func connect() async throws {
        try await database.connect(connector: DummyConnector(), options: nil)
        // Main-actor-isolated connector:
        try await database.connect(connector: MainActorConnector(), options: nil)
    }

    func stop() {
        watchTask?.cancel()
        statusTask?.cancel()
    }
}

// MARK: Detached use across isolation domains

func crossActorUse() async throws {
    let db = openCheckDatabase()
    let holder = DatabaseHolder(database: db)
    let t = Task.detached { try await holder.incomes() }
    _ = try await t.value
    // passing the database itself into a detached task
    let t2 = Task.detached { try await db.getAll("SELECT 1") { try $0.getInt(index: 0) } }
    _ = try await t2.value
    try await db.close()
}
