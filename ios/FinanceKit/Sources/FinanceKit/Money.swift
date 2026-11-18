import Foundation

/// Display and input helpers for euro amounts held as integer cents.
///
/// Not the same as `money.ts`: `format` drops decimals on whole amounts and
/// `percent` takes a ratio. `parse` follows `parseMoneyInput`.
public enum Money {
    public static let locale = Locale(identifier: "en_GB")

    /// Whole amounts drop the decimals; anything else shows two.
    public static func format(_ cents: Int) -> String {
        let digits = cents % 100 == 0 ? 0 : 2
        return (Decimal(cents) / 100).formatted(
            .currency(code: "EUR")
                .precision(.fractionLength(digits))
                .locale(locale)
        )
    }

    /// "43%" for 0.43.
    public static func percent(_ ratio: Double) -> String {
        ratio.formatted(.percent.precision(.fractionLength(0)).locale(locale))
    }

    /// Largest amount a field accepts, one billion euros (`MAX_AMOUNT_CENTS`).
    public static let maxAmountCents = 100_000_000_000

    /// Parses "12", "12.5" or "12,50" into cents, like `parseMoneyInput` on
    /// the web: whitespace is ignored, either "," or "." is the decimal
    /// separator, and at most one separator and two decimals are allowed.
    /// A bare separator ("." or ".5"), signs, exponents, a second separator
    /// ("1.2.3", "1,000,50") or an amount above `maxAmountCents` give nil.
    ///
    /// Empty input and zero are valid only with `allowZero` (the web returns
    /// 0 for an empty field); the add-expense sheet requires a positive amount.
    public static func parse(_ text: String, allowZero: Bool = false) -> Int? {
        let compact = text.filter { !$0.isWhitespace }
        if compact.isEmpty { return allowZero ? 0 : nil }

        // Like the web, only the first comma becomes a point.
        var normalized = compact
        if let comma = normalized.firstIndex(of: ",") {
            normalized.replaceSubrange(comma...comma, with: ".")
        }

        let parts = normalized.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        guard let whole = parts.first, !whole.isEmpty, whole.allSatisfy(isAsciiDigit) else { return nil }
        let fraction = parts.count > 1 ? parts[1] : ""
        guard fraction.count <= 2, fraction.allSatisfy(isAsciiDigit) else { return nil }

        // Integer maths only: no floating point, and the cap stops overflow.
        var cents = 0
        for digit in whole {
            guard let value = digit.wholeNumberValue else { return nil }
            cents = cents * 10 + value
            if cents > maxAmountCents { return nil }
        }
        var fractionCents = 0
        for digit in fraction + String(repeating: "0", count: 2 - fraction.count) {
            guard let value = digit.wholeNumberValue else { return nil }
            fractionCents = fractionCents * 10 + value
        }
        cents = cents * 100 + fractionCents
        guard cents <= maxAmountCents else { return nil }
        return cents > 0 || allowZero ? cents : nil
    }

    private static func isAsciiDigit(_ character: Character) -> Bool {
        character.isASCII && character.isNumber
    }

    /// Signed amount with its currency and always two decimals, for a bank
    /// transaction ("-€12.50", "CHF 40.00").
    public static func formatTransaction(_ cents: Int, currency: String) -> String {
        (Decimal(cents) / 100).formatted(
            .currency(code: currency)
                .precision(.fractionLength(2))
                .locale(locale)
        )
    }

    /// Amount as it is typed in a field: "12", "12.5" or "12.34", no grouping.
    public static func inputText(_ cents: Int) -> String {
        guard cents > 0 else { return "" }
        let whole = cents / 100
        let fraction = cents % 100
        if fraction == 0 { return String(whole) }
        return "\(whole).\(fraction < 10 ? "0" : "")\(fraction)"
    }
}
