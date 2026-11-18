import Foundation

// Port of `src/domain/budget/calculations.ts`. Integer cents throughout.

public struct AccountAllocation: Codable, Hashable, Sendable {
    public var accountId: String
    public var accountName: String
    public var transferCents: Int
    public var usageCents: Int
    public var balanceCents: Int

    public init(
        accountId: String, accountName: String,
        transferCents: Int, usageCents: Int, balanceCents: Int
    ) {
        self.accountId = accountId
        self.accountName = accountName
        self.transferCents = transferCents
        self.usageCents = usageCents
        self.balanceCents = balanceCents
    }
}

public struct BudgetSummary: Codable, Hashable, Sendable {
    public var incomeCents: Int
    public var expenseCents: Int
    public var remainingCents: Int
    public var transferCents: Int
    public var unallocatedIncomeCents: Int
    /// Percentage of income left, 0 to 100 (not a ratio), as in the web app.
    public var savingsRate: Double
    public var accountAllocations: [AccountAllocation]
    public var unassignedExpenseCents: Int

    public init(
        incomeCents: Int, expenseCents: Int, remainingCents: Int,
        transferCents: Int, unallocatedIncomeCents: Int, savingsRate: Double,
        accountAllocations: [AccountAllocation], unassignedExpenseCents: Int
    ) {
        self.incomeCents = incomeCents
        self.expenseCents = expenseCents
        self.remainingCents = remainingCents
        self.transferCents = transferCents
        self.unallocatedIncomeCents = unallocatedIncomeCents
        self.savingsRate = savingsRate
        self.accountAllocations = accountAllocations
        self.unassignedExpenseCents = unassignedExpenseCents
    }
}

extension ExpenseCategory {
    public var totalCents: Int {
        items.reduce(0) { $0 + $1.amountCents }
    }
}

extension BudgetMonth {
    public var summary: BudgetSummary { calculateBudgetSummary(self) }
}

/// JavaScript `Math.round`: halves round toward positive infinity.
private func jsRound(_ value: Double) -> Double {
    let floor = value.rounded(.down)
    return value - floor >= 0.5 ? floor + 1 : floor
}

/// Share of an account's planned transfer that its expenses use, in percent.
/// Nil when nothing is planned.
public func allocationUsagePercent(_ allocation: AccountAllocation) -> Int? {
    guard allocation.transferCents > 0 else { return nil }
    let ratio = Double(allocation.usageCents) / Double(allocation.transferCents)
    return Int(jsRound(ratio * 100))
}

public func calculateBudgetSummary(_ budget: BudgetMonth) -> BudgetSummary {
    let incomeCents = budget.incomes.reduce(0) { $0 + $1.amountCents }
    let expenseCents = budget.expenseCategories.reduce(0) { $0 + $1.totalCents }
    let transferCents = budget.accounts.reduce(0) { $0 + $1.plannedTransferCents }

    var usageByAccount: [String: Int] = [:]
    var unassignedExpenseCents = 0
    for category in budget.expenseCategories {
        if let accountId = category.accountId, !accountId.isEmpty {
            usageByAccount[accountId, default: 0] += category.totalCents
        } else {
            unassignedExpenseCents += category.totalCents
        }
    }

    let accountAllocations = budget.accounts.map { account in
        let usageCents = usageByAccount[account.id] ?? 0
        return AccountAllocation(
            accountId: account.id,
            accountName: account.name,
            transferCents: account.plannedTransferCents,
            usageCents: usageCents,
            balanceCents: account.plannedTransferCents - usageCents
        )
    }

    let remainingCents = incomeCents - expenseCents
    return BudgetSummary(
        incomeCents: incomeCents,
        expenseCents: expenseCents,
        remainingCents: remainingCents,
        transferCents: transferCents,
        unallocatedIncomeCents: incomeCents - transferCents,
        savingsRate: incomeCents == 0
            ? 0 : Double(remainingCents) / Double(incomeCents) * 100,
        accountAllocations: accountAllocations,
        unassignedExpenseCents: unassignedExpenseCents
    )
}
