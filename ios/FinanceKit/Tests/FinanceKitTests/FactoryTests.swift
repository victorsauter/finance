import Foundation
import Testing
@testable import FinanceKit

@Suite struct FactoryTests {
    private func sampleData() throws -> AppData {
        let data = try Fixtures.appDataJSON("app-data")
        return try JSONDecoder().decode(AppData.self, from: data)
    }

    @Test func monthNavigationWrapsYears() {
        #expect(nextMonth(year: 2026, month: 12) == YearMonth(year: 2027, month: 1))
        #expect(nextMonth(year: 2026, month: 3) == YearMonth(year: 2026, month: 4))
        #expect(previousMonth(year: 2026, month: 1) == YearMonth(year: 2025, month: 12))
        #expect(previousMonth(year: 2026, month: 3) == YearMonth(year: 2026, month: 2))
    }

    @Test func rangeCheckAtTheYearBounds() {
        #expect(isBudgetMonthInRange(year: 2000, month: 1))
        #expect(isBudgetMonthInRange(year: 2200, month: 12))

        let beforeFirst = previousMonth(year: 2000, month: 1)
        #expect(!isBudgetMonthInRange(year: beforeFirst.year, month: beforeFirst.month))
        let afterLast = nextMonth(year: 2200, month: 12)
        #expect(!isBudgetMonthInRange(year: afterLast.year, month: afterLast.month))

        #expect(!isBudgetMonthInRange(year: 2026, month: 0))
        #expect(!isBudgetMonthInRange(year: 2026, month: 13))
    }

    @Test func monthKeyIsZeroPadded() {
        #expect(monthKey(year: 2026, month: 3) == "2026-03")
        #expect(monthKey(year: 2026, month: 11) == "2026-11")
    }

    @Test func monthNameMatchesTheWebLabel() {
        #expect(getMonthName(year: 2026, month: 11) == "November 2026")
        #expect(getMonthName(year: 2026, month: 5) == "May 2026")
    }

    @Test func timestampLooksLikeToISOString() {
        #expect(isoTimestamp(Date(timeIntervalSince1970: 0)) == "1970-01-01T00:00:00.000Z")
    }

    @Test func idsAreLowercaseUUIDs() {
        let id = createId()
        #expect(UUID(uuidString: id) != nil)
        #expect(id == id.lowercased())
        #expect(createId() != id)
    }

    @Test func emptyMonthHasOneOfEverything() {
        let month = createEmptyBudgetMonth(year: 2026, month: 7)
        #expect(month.name == "July 2026")
        #expect(month.incomes.map(\.name) == ["Main income"])
        #expect(month.accounts.map(\.name) == ["Main account"])
        #expect(month.expenseCategories.map(\.name) == ["Housing"])
        #expect(month.expenseCategories[0].accountId == month.accounts[0].id)
        #expect(month.expenseCategories[0].items.map(\.name) == ["Rent / mortgage"])
        #expect(month.summary.incomeCents == 0)
    }

    @Test func initialAppDataUsesTheGivenMonth() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
        let date = Date(timeIntervalSince1970: 1_782_000_000) // June 2026
        let data = createInitialAppData(date: date, calendar: calendar)
        #expect(data.schemaVersion == 2)
        #expect(data.budgetMonths.count == 1)
        #expect(data.budgetMonths[0].year == 2026)
        #expect(data.budgetMonths[0].month == 6)
        #expect(data.settings.activeBudgetMonthId == data.budgetMonths[0].id)
    }

    @Test func findBudgetMatchesYearAndMonth() throws {
        let data = try sampleData()
        #expect(findBudget(in: data, year: 2026, month: 2)?.name == "February 2026")
        #expect(findBudget(in: data, year: 2026, month: 3) == nil)
    }

    @Test func seedCopiesTheNearestEarlierMonth() throws {
        let data = try sampleData()
        let february = data.budgetMonths[1]
        let seeded = seedMonthFrom(data, year: 2026, month: 5)

        #expect(seeded.year == 2026)
        #expect(seeded.month == 5)
        #expect(seeded.name == "May 2026")
        #expect(seeded.incomes.map(\.name) == february.incomes.map(\.name))
        #expect(seeded.incomes.map(\.amountCents) == february.incomes.map(\.amountCents))
        #expect(seeded.accounts.map(\.plannedTransferCents)
            == february.accounts.map(\.plannedTransferCents))
        #expect(seeded.summary.expenseCents == february.summary.expenseCents)

        // Fresh identifiers everywhere, with category links remapped.
        func ids(_ month: BudgetMonth) -> Set<String> {
            var all: Set<String> = [month.id]
            month.incomes.forEach { all.insert($0.id) }
            month.accounts.forEach { all.insert($0.id) }
            for category in month.expenseCategories {
                all.insert(category.id)
                category.items.forEach { all.insert($0.id) }
            }
            return all
        }
        #expect(ids(seeded).isDisjoint(with: ids(february)))
        let newAccountIds = Set(seeded.accounts.map(\.id))
        for category in seeded.expenseCategories {
            let accountId = try #require(category.accountId)
            #expect(newAccountIds.contains(accountId))
        }
        #expect(seeded.summary.accountAllocations.map(\.usageCents)
            == february.summary.accountAllocations.map(\.usageCents))
    }

    @Test func seedIgnoresLaterMonths() throws {
        let data = try sampleData()
        // Nothing precedes January 2026, so the month starts empty even
        // though later months exist.
        let seeded = seedMonthFrom(data, year: 2026, month: 1)
        #expect(seeded.incomes.map(\.name) == ["Main income"])

        let december = seedMonthFrom(data, year: 2025, month: 12)
        #expect(december.name == "December 2025")
        #expect(december.accounts.map(\.name) == ["Main account"])
    }

    @Test func seedAcrossAYearBoundaryUsesDecember() throws {
        var data = try sampleData()
        var december = data.budgetMonths[0]
        december.year = 2025
        december.month = 12
        data.budgetMonths.append(december)
        let seeded = seedMonthFrom(data, year: 2026, month: 1)
        // January copies December 2025 (index 24311), not an empty month.
        #expect(seeded.incomes.map(\.name) == december.incomes.map(\.name))
    }
}
