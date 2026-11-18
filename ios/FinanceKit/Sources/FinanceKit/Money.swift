import Foundation

/// Display and input helpers for euro amounts held as integer cents.
///
/// Not the same as `money.ts`: `format` drops decimals on whole amounts,
/// `percent` takes a ratio, and `parse` rejects zero but rounds extra decimals.
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

    /// Parses "12", "12.5" or "12,50" into cents. Nil for anything else or
    /// for amounts that are not strictly positive.
    public static func parse(_ text: String) -> Int? {
        let normalized = text
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: ",", with: ".")
        guard !normalized.isEmpty,
              normalized.allSatisfy({ $0.isNumber || $0 == "." }),
              let value = Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX"))
        else { return nil }
        let cents = NSDecimalNumber(decimal: value * 100).rounding(
            accordingToBehavior: NSDecimalNumberHandler(
                roundingMode: .plain, scale: 0,
                raiseOnExactness: false, raiseOnOverflow: false,
                raiseOnUnderflow: false, raiseOnDivideByZero: false
            )
        ).intValue
        return cents > 0 ? cents : nil
    }
}
