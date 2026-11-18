import Foundation
import Testing
@testable import FinanceKit

@Suite struct PersistenceTests {
    private func makeDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appending(path: "FinanceKitTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    private func sampleData() throws -> AppData {
        let data = try Fixtures.appDataJSON("app-data")
        return try JSONDecoder().decode(AppData.self, from: data)
    }

    @Test func loadReturnsNilWhenNothingSaved() async throws {
        let repository = FileBudgetRepository(directory: makeDirectory())
        #expect(try await repository.load() == nil)
    }

    @Test func saveThenLoadReturnsTheSameData() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = FileBudgetRepository(directory: directory)
        let data = try sampleData()

        try await repository.save(data)
        #expect(try await repository.load() == data)
        // A fresh instance reads the same file, as after an app relaunch.
        #expect(try await FileBudgetRepository(directory: directory).load() == data)
    }

    @Test func saveOverwritesThePreviousDocument() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = FileBudgetRepository(directory: directory)
        var data = try sampleData()
        try await repository.save(data)

        data.budgetMonths[0].incomes[0].amountCents = 123_456
        try await repository.save(data)
        let loaded = try await repository.load()
        #expect(loaded?.budgetMonths[0].incomes[0].amountCents == 123_456)
    }

    @Test func clearRemovesTheFile() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = FileBudgetRepository(directory: directory)
        try await repository.save(try sampleData())

        try await repository.clear()
        #expect(try await repository.load() == nil)
        // Clearing twice is harmless.
        try await repository.clear()
    }

    @Test func corruptFileThrowsInsteadOfLookingEmpty() async throws {
        let directory = makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = FileBudgetRepository(directory: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: repository.fileURL)

        await #expect(throws: (any Error).self) {
            try await repository.load()
        }
    }

    @Test func inMemoryRepositoryBehavesTheSame() async throws {
        let repository = InMemoryBudgetRepository()
        #expect(try await repository.load() == nil)
        let data = try sampleData()
        try await repository.save(data)
        #expect(try await repository.load() == data)
        try await repository.clear()
        #expect(try await repository.load() == nil)
    }
}
