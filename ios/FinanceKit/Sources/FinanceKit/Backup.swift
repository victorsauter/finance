import Foundation

// Reading and writing the JSON backup of the web `/backup` page, with the
// checks of `src/domain/budget/schema.ts` so a bad file never replaces data.

public enum BackupError: Error, Equatable, LocalizedError {
    case tooLarge
    case notJSON
    case invalid([String])

    public var errorDescription: String? {
        switch self {
        case .tooLarge:
            "This file is larger than the 20 MB limit for a backup."
        case .notJSON:
            "Invalid backup: the file is not valid JSON."
        case .invalid(let issues):
            "Invalid backup. " + issues.prefix(3).joined(separator: "; ")
                + (issues.count > 3 ? " (and \(issues.count - 3) more)" : "")
        }
    }
}

public enum BackupFile {
    public static let maxBytes = 20 * 1024 * 1024

    /// Decodes and validates a backup. Schema v1 files load without
    /// transactions, like the web migration.
    public static func decode(_ data: Data) throws(BackupError) -> AppData {
        guard data.count <= maxBytes else { throw .tooLarge }
        guard (try? JSONSerialization.jsonObject(with: data)) != nil else { throw .notJSON }
        let appData: AppData
        do {
            appData = try JSONDecoder().decode(AppData.self, from: data)
        } catch let error as DecodingError {
            throw .invalid([describe(error)])
        } catch {
            throw .invalid([error.localizedDescription])
        }
        let issues = validate(appData)
        guard issues.isEmpty else { throw .invalid(issues) }
        return appData
    }

    /// The same JSON the web app downloads: stable key order, readable.
    public static func encode(_ data: AppData) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
        return try encoder.encode(data)
    }

    /// Cross-checks of `appDataSchema`: at least one month, an existing active
    /// month, one budget per month, unique UUID identifiers, valid accounts,
    /// amounts within bounds and transaction categories that exist.
    public static func validate(_ data: AppData) -> [String] {
        var issues: [String] = []
        var ids = Set<String>()
        func register(_ id: String, _ path: String) {
            if UUID(uuidString: id) == nil {
                issues.append("\(path): not a valid identifier")
            } else if !ids.insert(id.lowercased()).inserted {
                issues.append("\(path): this identifier is used more than once")
            }
        }
        func checkAmount(_ cents: Int, _ path: String) {
            if cents < 0 || cents > Money.maxAmountCents {
                issues.append("\(path): amount out of range")
            }
        }
        func checkName(_ name: String, _ path: String) {
            if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append("\(path): the name cannot be empty")
            }
        }

        if data.budgetMonths.isEmpty {
            issues.append("budgetMonths: at least one budget is required")
        }
        if !data.budgetMonths.contains(where: { $0.id == data.settings.activeBudgetMonthId }) {
            issues.append("settings.activeBudgetMonthId: the active budget does not match any month")
        }

        var monthKeys = Set<String>()
        var categoryIdsByMonth: [String: Set<String>] = [:]
        for (b, budget) in data.budgetMonths.enumerated() {
            let base = "budgetMonths.\(b)"
            register(budget.id, "\(base).id")
            if !isBudgetMonthInRange(year: budget.year, month: budget.month) {
                issues.append("\(base): month out of range")
            }
            checkName(budget.name, "\(base).name")
            let key = monthKey(year: budget.year, month: budget.month)
            if !monthKeys.insert(key).inserted {
                issues.append("\(base): two budgets use the same month")
            }
            if !isISODateTime(budget.createdAt) || !isISODateTime(budget.updatedAt) {
                issues.append("\(base): invalid date")
            }
            for (i, income) in budget.incomes.enumerated() {
                register(income.id, "\(base).incomes.\(i).id")
                checkName(income.name, "\(base).incomes.\(i).name")
                checkAmount(income.amountCents, "\(base).incomes.\(i).amountCents")
            }
            for (i, account) in budget.accounts.enumerated() {
                register(account.id, "\(base).accounts.\(i).id")
                checkName(account.name, "\(base).accounts.\(i).name")
                checkAmount(account.plannedTransferCents, "\(base).accounts.\(i).plannedTransferCents")
            }
            let accountIds = Set(budget.accounts.map(\.id))
            var categoryIds = Set<String>()
            for (c, category) in budget.expenseCategories.enumerated() {
                let path = "\(base).expenseCategories.\(c)"
                register(category.id, "\(path).id")
                categoryIds.insert(category.id)
                checkName(category.name, "\(path).name")
                if let accountId = category.accountId, !accountIds.contains(accountId) {
                    issues.append("\(path).accountId: the account assigned to this category cannot be found")
                }
                for (i, item) in category.items.enumerated() {
                    register(item.id, "\(path).items.\(i).id")
                    checkName(item.name, "\(path).items.\(i).name")
                    checkAmount(item.amountCents, "\(path).items.\(i).amountCents")
                }
            }
            categoryIdsByMonth[key] = categoryIds
        }

        var sourceKeys = Set<String>()
        for (t, transaction) in data.importedTransactions.enumerated() {
            let path = "importedTransactions.\(t)"
            register(transaction.id, "\(path).id")
            if transaction.amountCents == 0 {
                issues.append("\(path).amountCents: the transaction amount cannot be zero")
            }
            if !isISODate(transaction.bookingDate) {
                issues.append("\(path).bookingDate: invalid date")
            }
            if !sourceKeys.insert(transaction.sourceKey).inserted {
                issues.append("\(path).sourceKey: this bank transaction has been imported more than once")
            }
            if let categoryId = transaction.categoryId,
               !(categoryIdsByMonth[String(transaction.bookingDate.prefix(7))]?.contains(categoryId) ?? false) {
                issues.append("\(path).categoryId: the category cannot be found for its month")
            }
        }
        return issues
    }

    private static func isISODate(_ text: String) -> Bool {
        guard text.count == 10 else { return false }
        let parts = text.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let components = DateComponents(year: year, month: month, day: day)
        guard let date = calendar.date(from: components) else { return false }
        return calendar.dateComponents([.year, .month, .day], from: date) == components
    }

    private static func isISODateTime(_ text: String) -> Bool {
        (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text)) != nil
            || (try? Date.ISO8601FormatStyle().parse(text)) != nil
    }

    private static func describe(_ error: DecodingError) -> String {
        func path(_ context: DecodingError.Context) -> String {
            context.codingPath.map(\.stringValue).joined(separator: ".")
        }
        switch error {
        case .keyNotFound(let key, let context):
            let location = path(context)
            return "\(location.isEmpty ? key.stringValue : location + "." + key.stringValue): required field is missing"
        case .typeMismatch(_, let context), .valueNotFound(_, let context):
            return "\(path(context)): unexpected value"
        case .dataCorrupted(let context):
            let location = path(context)
            return location.isEmpty
                ? context.debugDescription
                : "\(location): \(context.debugDescription)"
        @unknown default:
            return error.localizedDescription
        }
    }
}
