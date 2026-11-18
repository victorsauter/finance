import Foundation
import Testing
@testable import FinanceKit

@Suite struct CalculationsTests {
    @Test func findsFixtures() {
        #expect(Fixtures.names.count >= 4)
    }

    @Test(arguments: Fixtures.names)
    func matchesSharedFixture(_ name: String) throws {
        let fixture = try Fixtures.load(name)
        #expect(fixture.months.count == fixture.expected.count)

        for (month, expected) in zip(fixture.months, fixture.expected) {
            let summary = calculateBudgetSummary(month)
            #expect(summary == expected.summary)
            #expect(
                summary.accountAllocations.map(allocationUsagePercent)
                    == expected.accountUsagePercent
            )
        }
    }

    @Test func usagePercentRoundsHalvesUp() {
        func percent(_ transfer: Int, _ usage: Int) -> Int? {
            allocationUsagePercent(AccountAllocation(
                accountId: "a", accountName: "A",
                transferCents: transfer, usageCents: usage,
                balanceCents: transfer - usage
            ))
        }
        #expect(percent(800, 100) == 13) // 12.5
        #expect(percent(0, 100) == nil)
        #expect(percent(-5, 100) == nil)
        #expect(percent(300, 100) == 33)
    }
}
