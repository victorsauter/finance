import Foundation
import Testing
@testable import FinanceKit

@Suite struct BackupTests {
    private func valid() throws -> AppData {
        try BackupFile.decode(Fixtures.appDataJSON("app-data"))
    }

    private func issues(of mutate: (inout AppData) -> Void) throws -> [String] {
        var data = try valid()
        mutate(&data)
        return BackupFile.validate(data)
    }

    @Test func webFixtureIsAValidBackup() throws {
        let data = try valid()
        #expect(!data.budgetMonths.isEmpty)
        #expect(BackupFile.validate(data).isEmpty)
    }

    @Test func roundTripsThroughEncode() throws {
        let original = try valid()
        let decoded = try BackupFile.decode(BackupFile.encode(original))
        #expect(decoded == original)
    }

    @Test func notJSONIsReportedAsSuch() {
        #expect(throws: BackupError.notJSON) { try BackupFile.decode(Data("hello".utf8)) }
        #expect(throws: BackupError.notJSON) { try BackupFile.decode(Data()) }
    }

    @Test func wrongShapeAndVersionAreRejectedWithAMessage() {
        for text in ["{}", "[]", #"{"schemaVersion": 3, "settings": {}, "budgetMonths": []}"#,
                     #"{"schemaVersion": 2}"#] {
            do {
                _ = try BackupFile.decode(Data(text.utf8))
                Issue.record("accepted \(text)")
            } catch {
                #expect(error.localizedDescription.hasPrefix("Invalid backup"))
            }
        }
    }

    @Test func oversizedFilesAreRejected() {
        let big = Data(count: BackupFile.maxBytes + 1)
        #expect(throws: BackupError.tooLarge) { try BackupFile.decode(big) }
    }

    @Test func schemaVersionOneLoadsWithoutTransactions() throws {
        var object = try #require(
            JSONSerialization.jsonObject(with: Fixtures.appDataJSON("app-data")) as? [String: Any]
        )
        object["schemaVersion"] = 1
        object.removeValue(forKey: "importedTransactions")
        let data = try BackupFile.decode(JSONSerialization.data(withJSONObject: object))
        #expect(data.importedTransactions.isEmpty)
        #expect(data.schemaVersion == currentSchemaVersion)
    }

    @Test func detectsEmptyOrMissingActiveMonth() throws {
        #expect(try !issues { $0.settings.activeBudgetMonthId = "nope" }.isEmpty)
        #expect(try !issues { $0.settings.activeBudgetMonthId = nil }.isEmpty)
        #expect(try !issues { $0.budgetMonths = [] }.isEmpty)
    }

    @Test func detectsDuplicateMonthsAndIds() throws {
        #expect(try issues {
            var copy = $0.budgetMonths[0]
            copy.id = createId()
            $0.budgetMonths.append(copy)
        }.contains { $0.contains("same month") })
        #expect(try issues {
            $0.budgetMonths[0].incomes.append($0.budgetMonths[0].incomes[0])
        }.contains { $0.contains("more than once") })
    }

    @Test func detectsBadValues() throws {
        #expect(try !issues { $0.budgetMonths[0].incomes[0].amountCents = -1 }.isEmpty)
        #expect(try !issues {
            $0.budgetMonths[0].incomes[0].amountCents = Money.maxAmountCents + 1
        }.isEmpty)
        #expect(try !issues { $0.budgetMonths[0].incomes[0].name = "  " }.isEmpty)
        #expect(try !issues { $0.budgetMonths[0].incomes[0].id = "not-a-uuid" }.isEmpty)
        #expect(try !issues { $0.budgetMonths[0].year = 1999 }.isEmpty)
        #expect(try !issues { $0.budgetMonths[0].createdAt = "yesterday" }.isEmpty)
    }

    @Test func detectsUnknownAccountOnACategory() throws {
        #expect(try issues {
            $0.budgetMonths[0].expenseCategories[0].accountId = createId()
        }.contains { $0.contains("account assigned") })
    }

    @Test func detectsBadTransactions() throws {
        let month = try #require(try valid().budgetMonths.first)
        let key = monthKey(year: month.year, month: month.month)
        func make(date: String, sourceKey: String = "k", category: String? = nil,
                  cents: Int = -100) -> ImportedTransaction {
            ImportedTransaction(
                id: createId(), sourceKey: sourceKey, sourceReference: nil,
                importBatchId: createId(), sourceFileName: "x.csv", bookingDate: date,
                startedAt: nil, completedAt: nil, description: "x", amountCents: cents,
                feeCents: 0, balanceCents: nil, currency: "EUR", transactionType: nil,
                product: nil, kind: .expense, categoryId: category, importedAt: isoTimestamp()
            )
        }
        #expect(try issues { $0.importedTransactions = [make(date: "\(key)-02")] }.isEmpty)
        #expect(try issues { $0.importedTransactions = [make(date: "\(key)-31x")] }
            .contains { $0.contains("bookingDate") })
        #expect(try issues { $0.importedTransactions = [make(date: "2026-02-30")] }
            .contains { $0.contains("bookingDate") })
        #expect(try issues { $0.importedTransactions = [make(date: "\(key)-02", cents: 0)] }
            .contains { $0.contains("zero") })
        #expect(try issues {
            $0.importedTransactions = [make(date: "\(key)-02"), make(date: "\(key)-03")]
        }.contains { $0.contains("more than once") })
        #expect(try issues {
            $0.importedTransactions = [make(date: "\(key)-02", category: createId())]
        }.contains { $0.contains("category") })
    }

    @Test func descriptionListsAtMostThreeIssues() {
        let error = BackupError.invalid(["a", "b", "c", "d", "e"])
        #expect(error.localizedDescription == "Invalid backup. a; b; c (and 2 more)")
    }
}
