import FinanceKit

/// SF Symbol for an expense category. The web model has no icon, so it is
/// derived from the name, falling back to a symbol picked by position.
enum CategorySymbol {
    private static let keywords: [(words: [String], symbol: String)] = [
        (["housing", "rent", "home", "mortgage"], "house.fill"),
        (["food", "grocer", "restaurant", "lunch"], "cart.fill"),
        (["transport", "transit", "car", "commute"], "tram.fill"),
        (["leisure", "fun", "entertain", "hobb"], "sparkles"),
        (["travel", "holiday", "vacation", "trip"], "airplane"),
        (["health", "medical", "pharmacy"], "cross.case.fill"),
        (["saving", "invest"], "banknote.fill"),
    ]

    private static let fallbacks = [
        "tag.fill", "star.fill", "bag.fill", "gift.fill", "heart.fill", "leaf.fill",
    ]

    static func symbol(for category: ExpenseCategory, at index: Int) -> String {
        let name = category.name.lowercased()
        for entry in keywords where entry.words.contains(where: name.contains) {
            return entry.symbol
        }
        return fallbacks[index % fallbacks.count]
    }
}
