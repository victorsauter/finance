import Testing
@testable import FinanceKit

@Suite struct MoneyTests {
    @Test(arguments: [
        ("12", 1200), ("12.5", 1250), ("12,50", 1250), ("0.01", 1),
        ("  7 ", 700), ("1000", 100_000), ("0,5", 50),
    ])
    func parsesAmounts(_ text: String, _ cents: Int) {
        #expect(Money.parse(text) == cents)
    }

    @Test(arguments: ["", "   ", "0", "0.00", "abc", "-5", "1e3", "12 eur", "€12"])
    func rejectsInvalidInput(_ text: String) {
        #expect(Money.parse(text) == nil)
    }

    @Test func formatsWholeAmountsWithoutDecimals() {
        #expect(Money.format(120_000) == "€1,200")
        #expect(Money.format(0) == "€0")
    }

    @Test func formatsFractionalAmountsWithTwoDecimals() {
        #expect(Money.format(46_550) == "€465.50")
        #expect(Money.format(3_499) == "€34.99")
        #expect(Money.format(5) == "€0.05")
    }

    @Test func percentTakesARatio() {
        #expect(Money.percent(0.43) == "43%")
        #expect(Money.percent(0) == "0%")
        #expect(Money.percent(1) == "100%")
    }
}
