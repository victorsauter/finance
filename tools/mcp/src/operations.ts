/**
 * Pure, targeted edits of the finance document. Each takes the current
 * document, works on a structuredClone and returns the next document with the
 * list of changes. Nothing is applied partially: any unknown id or unresolved
 * category throws a ToolError before anything is returned.
 */
import type {
  AppData,
  BudgetMonth,
  ImportedTransaction,
  ImportedTransactionKind,
} from '../../../src/domain/budget/models.ts'
import { createExpenseItem } from '../../../src/domain/budget/factory.ts'
import { MAX_AMOUNT_CENTS, formatMoney } from '../../../src/domain/budget/money.ts'
import { removeById } from '../../../src/domain/budget/ordering.ts'
import { changeLine, type Change } from './diff.ts'
import {
  ToolError,
  UNCATEGORISED,
  budgetKey,
  categoryIndex,
  categoryLabel,
  dateBound,
  inDateRange,
  merchantKey,
  requireBudget,
  sameName,
  transactionMonth,
} from './helpers.ts'
import { formatTransactionAmount } from '../../../src/domain/transactions/format.ts'

export interface OperationResult {
  next: AppData
  changes: Change[]
  /** Human-readable diff, grouped when that reads better than one line per change. */
  lines: string[]
  /** Things that were deliberately left alone. */
  notes: string[]
  /** What the cap of changes per call counts. */
  changedCount: number
}

function result(next: AppData, changes: Change[], lines?: string[], notes: string[] = []): OperationResult {
  const changed = new Set(changes.map((change) => `${change.entity}:${change.id}`))
  return { next, changes, lines: lines ?? changes.map(changeLine), notes, changedCount: changed.size }
}

function transactionLabel(transaction: ImportedTransaction) {
  return `${transaction.bookingDate} ${transaction.description} ${formatTransactionAmount(transaction.amountCents, transaction.currency)} (${transaction.id})`
}

function findTransactions(data: AppData, ids: string[]) {
  const unique = [...new Set(ids)]
  const byId = new Map(data.importedTransactions.map((transaction) => [transaction.id, transaction]))
  const unknown = unique.filter((id) => !byId.has(id))
  if (unknown.length > 0) {
    throw new ToolError(`Unknown transaction id(s), nothing changed: ${unknown.join(', ')}`)
  }
  return unique.map((id) => byId.get(id)!)
}

function categoryIdsOf(budget: BudgetMonth | undefined) {
  return new Set(budget?.expenseCategories.map((category) => category.id) ?? [])
}

function budgetsByKey(data: AppData) {
  return new Map(data.budgetMonths.map((budget) => [budgetKey(budget), budget]))
}

/** Sets (or clears) the category of transactions given by id. */
export function setTransactionCategory(
  data: AppData,
  ids: string[],
  categoryId: string | null,
): OperationResult {
  const next = structuredClone(data)
  const transactions = findTransactions(next, ids)
  const index = categoryIndex(next)
  if (categoryId !== null && !index.has(categoryId)) {
    throw new ToolError(`Unknown category id ${categoryId}. Use list_categories(month).`)
  }
  const budgets = budgetsByKey(next)
  const problems: string[] = []
  for (const transaction of transactions) {
    if (categoryId === null) continue
    if (transaction.kind !== 'expense') {
      problems.push(`${transaction.id} is a ${transaction.kind}, only expenses have a category (use set_transaction_kind first)`)
      continue
    }
    const month = transactionMonth(transaction)
    if (!categoryIdsOf(budgets.get(month)).has(categoryId)) {
      problems.push(
        `${transaction.id} is in ${month} but category ${categoryId} belongs to ${index.get(categoryId)!.month}`,
      )
    }
  }
  if (problems.length > 0) {
    throw new ToolError(
      `Nothing changed. A transaction's category must belong to the budget of the transaction's own month:\n- ${problems.join('\n- ')}`,
    )
  }

  const changes: Change[] = []
  for (const transaction of transactions) {
    if (transaction.categoryId === categoryId) continue
    changes.push({
      entity: 'transaction', id: transaction.id, label: transactionLabel(transaction), field: 'category',
      before: categoryLabel(index, transaction.categoryId), after: categoryLabel(index, categoryId),
    })
    transaction.categoryId = categoryId
  }
  return result(next, changes)
}

/** Sets the kind of transactions; a non-expense loses its category, as in the web app. */
export function setTransactionKind(
  data: AppData,
  ids: string[],
  kind: ImportedTransactionKind,
): OperationResult {
  const next = structuredClone(data)
  const transactions = findTransactions(next, ids)
  const index = categoryIndex(next)
  const changes: Change[] = []
  for (const transaction of transactions) {
    applyKind(transaction, kind, index, changes)
  }
  return result(next, changes)
}

function applyKind(
  transaction: ImportedTransaction,
  kind: ImportedTransactionKind,
  index: ReturnType<typeof categoryIndex>,
  changes: Change[],
) {
  if (transaction.kind !== kind) {
    changes.push({
      entity: 'transaction', id: transaction.id, label: transactionLabel(transaction), field: 'kind',
      before: transaction.kind, after: kind,
    })
    transaction.kind = kind
  }
  if (kind !== 'expense' && transaction.categoryId !== null) {
    changes.push({
      entity: 'transaction', id: transaction.id, label: transactionLabel(transaction), field: 'category',
      before: categoryLabel(index, transaction.categoryId), after: UNCATEGORISED,
    })
    transaction.categoryId = null
  }
}

interface DescriptionGroup {
  merchant: string
  lastDate: string
  count: number
  totalCents: number
  months: Set<string>
  from: string
  to: string
}

function groupLines(groups: Map<string, DescriptionGroup>) {
  return [...groups.values()].map((group) => {
    const months = [...group.months].sort()
    const span = months.length > 1 ? `${months[0]}..${months.at(-1)}` : months[0]
    return `${group.merchant}: ${group.count} transaction(s), ${formatMoney(group.totalCents)}, ${span}: ${group.from} -> ${group.to}`
  })
}

function addToGroup(
  groups: Map<string, DescriptionGroup>,
  transaction: ImportedTransaction,
  from: string,
  to: string,
) {
  const key = `${merchantKey(transaction.description)}\u0000${from}\u0000${to}`
  const group = groups.get(key) ?? {
    merchant: transaction.description, lastDate: transaction.bookingDate, count: 0, totalCents: 0, months: new Set<string>(), from, to,
  }
  // Label with the most recent spelling, as merchant_summary does.
  if (transaction.bookingDate >= group.lastDate) {
    group.merchant = transaction.description
    group.lastDate = transaction.bookingDate
  }
  group.count += 1
  group.totalCents += transaction.amountCents
  group.months.add(transactionMonth(transaction))
  groups.set(key, group)
}

function matchingTransactions(
  data: AppData,
  description: string,
  from: string | undefined,
  to: string | undefined,
) {
  const key = merchantKey(description)
  if (key === '') throw new ToolError(`"${description}" has no letters or digits to match on.`)
  return data.importedTransactions.filter(
    (transaction) =>
      merchantKey(transaction.description) === key &&
      inDateRange(transaction.bookingDate, from, to),
  )
}

export interface CategoryMatch {
  description: string
  categoryName?: string
  categoryId?: string
}

/**
 * Categorises every expense whose normalised description equals one of the
 * given descriptions, between `from` and `to` inclusive. Categories are per
 * month: the target is resolved by NAME in each transaction's own month (a
 * `categoryId` is first turned into its name). If a month has no such
 * category, or two with that name, nothing is applied and the gaps are listed.
 */
export function categorizeByDescription(
  data: AppData,
  matches: CategoryMatch[],
  range: { from: string; to: string; overwrite?: boolean },
): OperationResult {
  const from = dateBound(range.from, 'from')
  const to = dateBound(range.to, 'to')
  const next = structuredClone(data)
  const index = categoryIndex(next)
  const budgets = budgetsByKey(next)
  const gaps: string[] = []
  const empty: string[] = []
  const notes: string[] = []
  const planned: Array<{ transaction: ImportedTransaction; categoryId: string }> = []
  const claimed = new Map<string, string>()

  for (const match of matches) {
    let targetName = match.categoryName?.trim()
    if (match.categoryId) {
      const category = index.get(match.categoryId)
      if (!category) throw new ToolError(`Unknown category id ${match.categoryId}. Use list_categories(month).`)
      if (targetName && !sameName(targetName, category.name)) {
        throw new ToolError(`categoryId ${match.categoryId} is "${category.name}", not "${targetName}".`)
      }
      targetName = category.name
    }
    if (!targetName) throw new ToolError(`Give categoryName or categoryId for "${match.description}".`)

    const found = matchingTransactions(next, match.description, from, to)
    if (found.length === 0) {
      empty.push(match.description)
      continue
    }
    let skippedKinds = 0
    let kept = 0
    for (const transaction of found) {
      if (transaction.kind !== 'expense') {
        skippedKinds += 1
        continue
      }
      const month = transactionMonth(transaction)
      const candidates = budgets.get(month)?.expenseCategories.filter((category) =>
        sameName(category.name, targetName),
      ) ?? []
      if (candidates.length !== 1) {
        const gap = `${month}: ${candidates.length === 0 ? 'no' : 'more than one'} category named "${targetName}"${budgets.has(month) ? '' : ' (no budget for this month)'}`
        if (!gaps.includes(gap)) gaps.push(gap)
        continue
      }
      const categoryId = candidates[0]!.id
      if (transaction.categoryId === categoryId) continue
      if (transaction.categoryId !== null && !range.overwrite) {
        kept += 1
        continue
      }
      const previous = claimed.get(transaction.id)
      if (previous && previous !== categoryId) {
        throw new ToolError(`Two matches give different categories to the same transactions ("${match.description}").`)
      }
      claimed.set(transaction.id, categoryId)
      planned.push({ transaction, categoryId })
    }
    if (skippedKinds > 0) {
      notes.push(`${match.description}: ${skippedKinds} income/transfer transaction(s) left alone (only expenses get a category).`)
    }
    if (kept > 0) {
      notes.push(`${match.description}: ${kept} transaction(s) already in another category kept (pass overwrite: true to replace).`)
    }
  }

  if (empty.length > 0) {
    throw new ToolError(
      `Nothing changed: no transaction between ${range.from} and ${range.to} matches ${empty.map((d) => `"${d}"`).join(', ')}. Descriptions are compared after removing case, accents and punctuation; use merchant_summary to see them.`,
    )
  }
  if (gaps.length > 0) {
    throw new ToolError(
      `Nothing changed: the category is missing in some months (categories belong to one month; create it there or narrow from/to):\n- ${gaps.join('\n- ')}`,
    )
  }

  const changes: Change[] = []
  const groups = new Map<string, DescriptionGroup>()
  const seen = new Set<string>()
  for (const { transaction, categoryId } of planned) {
    if (seen.has(transaction.id)) continue
    seen.add(transaction.id)
    const before = categoryLabel(index, transaction.categoryId)
    const after = categoryLabel(index, categoryId)
    changes.push({ entity: 'transaction', id: transaction.id, label: transactionLabel(transaction), field: 'category', before, after })
    addToGroup(groups, transaction, before, after)
    transaction.categoryId = categoryId
  }
  return result(next, changes, groupLines(groups), notes)
}

export interface KindMatch {
  description: string
  kind: ImportedTransactionKind
}

/** Same matching as categorizeByDescription, setting the kind instead. */
export function setKindByDescription(
  data: AppData,
  matches: KindMatch[],
  range: { from: string; to: string },
): OperationResult {
  const from = dateBound(range.from, 'from')
  const to = dateBound(range.to, 'to')
  const next = structuredClone(data)
  const index = categoryIndex(next)
  const empty: string[] = []
  const changes: Change[] = []
  const groups = new Map<string, DescriptionGroup>()
  const assigned = new Map<string, ImportedTransactionKind>()
  for (const match of matches) {
    const found = matchingTransactions(next, match.description, from, to)
    if (found.length === 0) empty.push(match.description)
    for (const transaction of found) {
      const previous = assigned.get(transaction.id)
      if (previous && previous !== match.kind) {
        throw new ToolError(`Two matches give different kinds to the same transactions ("${match.description}").`)
      }
      assigned.set(transaction.id, match.kind)
      const before = transaction.kind
      const count = changes.length
      applyKind(transaction, match.kind, index, changes)
      if (changes.length > count) addToGroup(groups, transaction, before, match.kind)
    }
  }
  if (empty.length > 0) {
    throw new ToolError(
      `Nothing changed: no transaction between ${range.from} and ${range.to} matches ${empty.map((d) => `"${d}"`).join(', ')}. Use merchant_summary to see descriptions.`,
    )
  }
  return result(next, changes, groupLines(groups))
}

function checkAmount(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > MAX_AMOUNT_CENTS) {
    throw new ToolError(`amountCents must be a whole number of cents between 0 and ${MAX_AMOUNT_CENTS}.`)
  }
}

function checkName(name: string) {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed.length > 200) throw new ToolError('The name must have 1 to 200 characters.')
  return trimmed
}

function findExpenseItem(budget: BudgetMonth, itemId: string) {
  for (const category of budget.expenseCategories) {
    const item = category.items.find((candidate) => candidate.id === itemId)
    if (item) return { category, item }
  }
  throw new ToolError(`No expense item ${itemId} in ${budgetKey(budget)}. Use get_budget(month).`)
}

/** Planned amount of an expense item. The month's updatedAt moves, as on the web. */
export function setPlannedAmount(
  data: AppData,
  month: string,
  itemId: string,
  amountCents: number,
  now = new Date().toISOString(),
): OperationResult {
  checkAmount(amountCents)
  const next = structuredClone(data)
  const budget = requireBudget(next, month)
  const { category, item } = findExpenseItem(budget, itemId)
  const changes: Change[] = []
  if (item.amountCents !== amountCents) {
    changes.push({
      entity: 'item', id: item.id, label: `${budgetKey(budget)} ${category.name} / ${item.name}`, field: 'planned',
      before: formatMoney(item.amountCents), after: formatMoney(amountCents),
    })
    item.amountCents = amountCents
    budget.updatedAt = now
  }
  return result(next, changes)
}

export function addExpenseItem(
  data: AppData,
  month: string,
  categoryId: string,
  name: string,
  amountCents: number,
  now = new Date().toISOString(),
): OperationResult {
  checkAmount(amountCents)
  const trimmed = checkName(name)
  const next = structuredClone(data)
  const budget = requireBudget(next, month)
  const category = budget.expenseCategories.find((candidate) => candidate.id === categoryId)
  if (!category) throw new ToolError(`No category ${categoryId} in ${budgetKey(budget)}. Use list_categories(month).`)
  const item = { ...createExpenseItem(trimmed, category.items.length), amountCents }
  category.items.push(item)
  budget.updatedAt = now
  return result(next, [{
    entity: 'item', id: item.id, label: `${budgetKey(budget)} ${category.name} / ${trimmed}`, field: 'new item',
    before: '(none)', after: formatMoney(amountCents),
  }])
}

/** Renames an income, account, category or expense item of the month. */
export function renameItem(
  data: AppData,
  month: string,
  itemId: string,
  name: string,
  now = new Date().toISOString(),
): OperationResult {
  const trimmed = checkName(name)
  const next = structuredClone(data)
  const budget = requireBudget(next, month)
  const entities: Array<{ kind: string; entity: { id: string; name: string } }> = [
    ...budget.incomes.map((entity) => ({ kind: 'income', entity })),
    ...budget.accounts.map((entity) => ({ kind: 'account', entity })),
    ...budget.expenseCategories.map((entity) => ({ kind: 'category', entity })),
    ...budget.expenseCategories.flatMap((category) =>
      category.items.map((entity) => ({ kind: 'expense item', entity })),
    ),
  ]
  const found = entities.find((candidate) => candidate.entity.id === itemId)
  if (!found) throw new ToolError(`Nothing with id ${itemId} in ${budgetKey(budget)}. Use get_budget(month).`)
  const { entity, kind } = found
  const changes: Change[] = []
  if (entity.name !== trimmed) {
    changes.push({
      entity: 'item', id: entity.id, label: `${budgetKey(budget)} ${kind}`, field: 'name',
      before: entity.name, after: trimmed,
    })
    entity.name = trimmed
    budget.updatedAt = now
  }
  return result(next, changes)
}

/** Deletes an expense item (not a category, income or account). */
export function deleteItem(
  data: AppData,
  month: string,
  itemId: string,
  now = new Date().toISOString(),
): OperationResult {
  const next = structuredClone(data)
  const budget = requireBudget(next, month)
  const { category, item } = findExpenseItem(budget, itemId)
  removeById(category.items, item.id)
  budget.updatedAt = now
  return result(next, [{
    entity: 'item', id: item.id, label: `${budgetKey(budget)} ${category.name} / ${item.name}`, field: 'deleted',
    before: formatMoney(item.amountCents), after: '(deleted)',
  }])
}
