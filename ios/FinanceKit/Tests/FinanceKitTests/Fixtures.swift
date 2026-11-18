import Foundation
import Testing
@testable import FinanceKit

/// Loads the contract fixtures in `fixtures/domain/` at the repository root.
/// The same files are read by `src/domain/budget/fixtures.test.ts`.
enum Fixtures {
    static let directory: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // FinanceKitTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // FinanceKit
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // repository root
        .appending(path: "fixtures/domain", directoryHint: .isDirectory)

    static var names: [String] {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: nil
        )) ?? []
        return files
            .filter { $0.pathExtension == "json" }
            .map { $0.deletingPathExtension().lastPathComponent }
            .sorted()
    }

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appending(path: "\(name).json"))
    }

    static func load(_ name: String) throws -> Fixture {
        try JSONDecoder().decode(Fixture.self, from: data(name))
    }

    /// The `appData` member of a fixture, as raw JSON.
    static func appDataJSON(_ name: String) throws -> Data {
        let root = try JSONSerialization.jsonObject(with: data(name)) as? [String: Any]
        let appData = try #require(root?["appData"])
        return try JSONSerialization.data(withJSONObject: appData)
    }
}

struct ExpectedResult: Decodable {
    var summary: BudgetSummary
    var accountUsagePercent: [Int?]
}

struct Fixture: Decodable {
    var description: String
    var budgetMonth: BudgetMonth?
    var appData: AppData?
    var expected: [ExpectedResult]

    private enum CodingKeys: String, CodingKey {
        case description, budgetMonth, appData, expected
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        description = try container.decode(String.self, forKey: .description)
        budgetMonth = try container.decodeIfPresent(BudgetMonth.self, forKey: .budgetMonth)
        appData = try container.decodeIfPresent(AppData.self, forKey: .appData)
        if let many = try? container.decode([ExpectedResult].self, forKey: .expected) {
            expected = many
        } else {
            expected = [try container.decode(ExpectedResult.self, forKey: .expected)]
        }
    }

    var months: [BudgetMonth] {
        if let budgetMonth { return [budgetMonth] }
        return appData?.budgetMonths ?? []
    }
}
