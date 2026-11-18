import Testing
@testable import FinanceKit

@Suite struct MoneyTests {
    @Test(arguments: [
        ("12", 1200), ("12.5", 1250), ("12,50", 1250), ("0.01", 1),
        ("  7 ", 700), ("1000", 100_000), ("0,5", 50), ("0.05", 5),
        ("1 234,56", 123_456), ("12.", 1200), ("12,", 1200), ("007", 700),
        ("12.55", 1255), ("1.10", 110),
        ("1000000000", Money.maxAmountCents),
    ])
    func parsesAmounts(_ text: String, _ cents: Int) {
        #expect(Money.parse(text) == cents)
    }

    @Test(arguments: [
        "abc", "-5", "+5", "1e3", "12 eur", "€12", "٣٤", "½",
        // More than two decimals, like the web's `12,345`.
        "12.345", "12,345", "0.001", "1.234",
        // More than one separator.
        "1.2.3", "1,000,50", "1,2,3", "1.2,3", "1,2.3", "..", ",,",
        // A bare separator or no whole part.
        ".", ",", ".5", ",50",
        // Above the web's one-billion-euro cap.
        "1000000000.01", "1000000001", "99999999999999999999",
    ])
    func rejectsInvalidInput(_ text: String) {
        #expect(Money.parse(text) == nil)
        #expect(Money.parse(text, allowZero: true) == nil)
    }

    @Test(arguments: ["", "   ", "0", "0.00", "0,0", "00"])
    func rejectsZeroUnlessAllowed(_ text: String) {
        #expect(Money.parse(text) == nil)
        #expect(Money.parse(text, allowZero: true) == 0)
    }

    @Test func allowZeroKeepsPositiveAmounts() {
        #expect(Money.parse("12,5", allowZero: true) == 1250)
    }

    @Test(arguments: [
        (0, ""), (1200, "12"), (1250, "12.50"),
        (5, "0.05"), (123_456, "1234.56"), (110, "1.10"),
    ])
    func inputTextRoundTrips(_ cents: Int, _ text: String) {
        #expect(Money.inputText(cents) == text)
        if cents > 0 { #expect(Money.parse(Money.inputText(cents)) == cents) }
    }

    @Test func formatsTransactionsWithSignAndTwoDecimals() {
        #expect(Money.formatTransaction(-1250, currency: "EUR") == "-€12.50")
        #expect(Money.formatTransaction(4000, currency: "EUR") == "€40.00")
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
