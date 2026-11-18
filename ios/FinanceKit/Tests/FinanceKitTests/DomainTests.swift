import Foundation
import Testing
@testable import FinanceKit

@Suite struct DomainTests {
    @Test func appDataSurvivesJSONRoundTrip() throws {
        let original = try Fixtures.appDataJSON("app-data")
        let decoded = try JSONDecoder().decode(AppData.self, from: original)
        let encoded = try JSONEncoder().encode(decoded)

        let before = try JSONSerialization.jsonObject(with: original) as? NSDictionary
        let after = try JSONSerialization.jsonObject(with: encoded) as? NSDictionary
        #expect(before != nil)
        #expect(before == after)
    }

    @Test func nullableFieldsAreWrittenAsNull() throws {
        let data = try Fixtures.appDataJSON("app-data")
        let decoded = try JSONDecoder().decode(AppData.self, from: data)
        let encoded = try JSONEncoder().encode(decoded)
        let root = try #require(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        let transactions = try #require(root["importedTransactions"] as? [[String: Any]])
        let second = try #require(transactions.last)
        #expect(second["startedAt"] is NSNull)
        #expect(second["balanceCents"] is NSNull)
        #expect(second["categoryId"] is NSNull)
        #expect(second.count == 19)
    }

    @Test func decodesTheFixtureContent() throws {
        let data = try Fixtures.appDataJSON("app-data")
        let decoded = try JSONDecoder().decode(AppData.self, from: data)
        #expect(decoded.schemaVersion == 2)
        #expect(decoded.budgetMonths.count == 2)
        #expect(decoded.importedTransactions.count == 2)
        #expect(decoded.importedTransactions[0].kind == .expense)
        #expect(decoded.importedTransactions[0].amountCents == -4250)
        #expect(decoded.settings.activeBudgetMonthId == decoded.budgetMonths[1].id)
    }

    @Test func rejectsUnknownSchemaVersion() {
        let json = #"{"schemaVersion":3,"settings":{"activeBudgetMonthId":null},"budgetMonths":[],"importedTransactions":[]}"#
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(AppData.self, from: Data(json.utf8))
        }
    }

    @Test func upgradesSchemaV1() throws {
        let json = #"{"schemaVersion":1,"settings":{"activeBudgetMonthId":null},"budgetMonths":[]}"#
        let decoded = try JSONDecoder().decode(AppData.self, from: Data(json.utf8))
        #expect(decoded.schemaVersion == 2)
        #expect(decoded.importedTransactions.isEmpty)
    }
}
