import Foundation
import Testing
@testable import FinanceKit

/// A document written by the web must survive a Swift decode and re-encode
/// without losing or changing anything, because the iPhone uploads what it
/// decoded. The Swift output is committed in `fixtures/sync/` and parsed by
/// `src/domain/budget/swiftRoundTrip.test.ts`, which checks the web accepts it.
/// Regenerate it with `UPDATE_SYNC_FIXTURE=1 swift test`.
@Suite struct RoundTripTests {
    private static let swiftOutput = Fixtures.directory
        .deletingLastPathComponent() // fixtures
        .appending(path: "sync/app-data.swift.json", directoryHint: .notDirectory)

    @Test func webDocumentRoundTripsWithoutLoss() throws {
        let web = try Fixtures.appDataJSON("app-data")
        let decoded = try JSONDecoder().decode(AppData.self, from: web)
        let encoded = try DocumentCoding.encode(decoded)

        let before = try #require(JSONSerialization.jsonObject(with: web) as? NSDictionary)
        let after = try #require(JSONSerialization.jsonObject(with: encoded) as? NSDictionary)
        #expect(before == after)
        #expect(try DocumentCoding.decodeRemote(encoded) == decoded)
    }

    @Test func committedSwiftOutputIsCurrent() throws {
        let decoded = try JSONDecoder().decode(AppData.self, from: Fixtures.appDataJSON("app-data"))
        var encoded = try DocumentCoding.encode(decoded)
        encoded.append(0x0A)
        if ProcessInfo.processInfo.environment["UPDATE_SYNC_FIXTURE"] == "1" {
            try encoded.write(to: Self.swiftOutput, options: .atomic)
        }
        #expect(try Data(contentsOf: Self.swiftOutput) == encoded)
    }

    @Test func fingerprintIgnoresKeyOrderButNotContent() throws {
        let data = try JSONDecoder().decode(AppData.self, from: Fixtures.appDataJSON("app-data"))
        var edited = data
        edited.budgetMonths[0].name = "Changed"
        #expect(DocumentCoding.fingerprint(data) == DocumentCoding.fingerprint(data))
        #expect(DocumentCoding.fingerprint(data) != DocumentCoding.fingerprint(edited))
    }
}
