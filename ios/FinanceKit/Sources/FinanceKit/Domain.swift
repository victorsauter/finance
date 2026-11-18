import Foundation

// Codable mirrors of `src/domain/budget/models.ts` (schema v2). JSON keys and
// nullability match the web document so a backup round-trips without loss.
// Ids are strings, amounts are integer cents, timestamps stay ISO strings.

public let currentSchemaVersion = 2
public let minBudgetYear = 2000
public let maxBudgetYear = 2200

public struct Income: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var amountCents: Int
    public var sortOrder: Int

    public init(id: String, name: String, amountCents: Int, sortOrder: Int) {
        self.id = id
        self.name = name
        self.amountCents = amountCents
        self.sortOrder = sortOrder
    }
}

public struct Account: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var plannedTransferCents: Int
    public var sortOrder: Int

    public init(id: String, name: String, plannedTransferCents: Int, sortOrder: Int) {
        self.id = id
        self.name = name
        self.plannedTransferCents = plannedTransferCents
        self.sortOrder = sortOrder
    }
}

public struct ExpenseItem: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var amountCents: Int
    public var sortOrder: Int

    public init(id: String, name: String, amountCents: Int, sortOrder: Int) {
        self.id = id
        self.name = name
        self.amountCents = amountCents
        self.sortOrder = sortOrder
    }
}

public struct ExpenseCategory: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var accountId: String?
    public var items: [ExpenseItem]
    public var sortOrder: Int

    public init(
        id: String, name: String, accountId: String?,
        items: [ExpenseItem], sortOrder: Int
    ) {
        self.id = id
        self.name = name
        self.accountId = accountId
        self.items = items
        self.sortOrder = sortOrder
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, accountId, items, sortOrder
    }

    // Swift omits nil keys by default; the web document writes `null`.
    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(accountId, forKey: .accountId)
        try container.encode(items, forKey: .items)
        try container.encode(sortOrder, forKey: .sortOrder)
    }
}

public struct BudgetMonth: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var year: Int
    public var month: Int
    public var name: String
    public var incomes: [Income]
    public var accounts: [Account]
    public var expenseCategories: [ExpenseCategory]
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String, year: Int, month: Int, name: String,
        incomes: [Income], accounts: [Account],
        expenseCategories: [ExpenseCategory],
        createdAt: String, updatedAt: String
    ) {
        self.id = id
        self.year = year
        self.month = month
        self.name = name
        self.incomes = incomes
        self.accounts = accounts
        self.expenseCategories = expenseCategories
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public enum ImportedTransactionKind: String, Codable, Hashable, Sendable {
    case expense, income, transfer
}

public struct ImportedTransaction: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var provider: String
    public var sourceKey: String
    public var sourceReference: String?
    public var importBatchId: String
    public var sourceFileName: String
    public var bookingDate: String
    public var startedAt: String?
    public var completedAt: String?
    public var description: String
    public var amountCents: Int
    public var feeCents: Int
    public var balanceCents: Int?
    public var currency: String
    public var transactionType: String?
    public var product: String?
    public var kind: ImportedTransactionKind
    public var categoryId: String?
    public var importedAt: String

    public init(
        id: String, provider: String = "revolut-csv", sourceKey: String,
        sourceReference: String?, importBatchId: String, sourceFileName: String,
        bookingDate: String, startedAt: String?, completedAt: String?,
        description: String, amountCents: Int, feeCents: Int,
        balanceCents: Int?, currency: String, transactionType: String?,
        product: String?, kind: ImportedTransactionKind, categoryId: String?,
        importedAt: String
    ) {
        self.id = id
        self.provider = provider
        self.sourceKey = sourceKey
        self.sourceReference = sourceReference
        self.importBatchId = importBatchId
        self.sourceFileName = sourceFileName
        self.bookingDate = bookingDate
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.description = description
        self.amountCents = amountCents
        self.feeCents = feeCents
        self.balanceCents = balanceCents
        self.currency = currency
        self.transactionType = transactionType
        self.product = product
        self.kind = kind
        self.categoryId = categoryId
        self.importedAt = importedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, provider, sourceKey, sourceReference, importBatchId
        case sourceFileName, bookingDate, startedAt, completedAt, description
        case amountCents, feeCents, balanceCents, currency, transactionType
        case product, kind, categoryId, importedAt
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(provider, forKey: .provider)
        try container.encode(sourceKey, forKey: .sourceKey)
        try container.encode(sourceReference, forKey: .sourceReference)
        try container.encode(importBatchId, forKey: .importBatchId)
        try container.encode(sourceFileName, forKey: .sourceFileName)
        try container.encode(bookingDate, forKey: .bookingDate)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(completedAt, forKey: .completedAt)
        try container.encode(description, forKey: .description)
        try container.encode(amountCents, forKey: .amountCents)
        try container.encode(feeCents, forKey: .feeCents)
        try container.encode(balanceCents, forKey: .balanceCents)
        try container.encode(currency, forKey: .currency)
        try container.encode(transactionType, forKey: .transactionType)
        try container.encode(product, forKey: .product)
        try container.encode(kind, forKey: .kind)
        try container.encode(categoryId, forKey: .categoryId)
        try container.encode(importedAt, forKey: .importedAt)
    }
}

public struct AppSettings: Codable, Hashable, Sendable {
    public var activeBudgetMonthId: String?

    public init(activeBudgetMonthId: String?) {
        self.activeBudgetMonthId = activeBudgetMonthId
    }

    private enum CodingKeys: String, CodingKey { case activeBudgetMonthId }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(activeBudgetMonthId, forKey: .activeBudgetMonthId)
    }
}

public struct AppData: Codable, Hashable, Sendable {
    public var schemaVersion: Int
    public var settings: AppSettings
    public var budgetMonths: [BudgetMonth]
    public var importedTransactions: [ImportedTransaction]

    public init(
        schemaVersion: Int = currentSchemaVersion,
        settings: AppSettings,
        budgetMonths: [BudgetMonth],
        importedTransactions: [ImportedTransaction] = []
    ) {
        self.schemaVersion = schemaVersion
        self.settings = settings
        self.budgetMonths = budgetMonths
        self.importedTransactions = importedTransactions
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, settings, budgetMonths, importedTransactions
    }

    /// Accepts schema v2, and v1 (no imported transactions), which the web
    /// app also migrates on import. Anything else is rejected.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .schemaVersion)
        guard version == 1 || version == currentSchemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .schemaVersion, in: container,
                debugDescription: "Unsupported schema version \(version)."
            )
        }
        schemaVersion = currentSchemaVersion
        settings = try container.decode(AppSettings.self, forKey: .settings)
        budgetMonths = try container.decode([BudgetMonth].self, forKey: .budgetMonths)
        importedTransactions = version == 1
            ? []
            : try container.decode([ImportedTransaction].self, forKey: .importedTransactions)
    }
}
