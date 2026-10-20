import { useMemo, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { useBudget } from '../../app/budget-context'
import type {
  ImportedTransaction,
  ImportedTransactionKind,
} from '../../domain/budget/models'
import { formatMoney } from '../../domain/budget/money'
import {
  formatMonthKey,
  formatTransactionAmount,
  formatTransactionDate,
} from '../../domain/transactions/format'
import { RevolutCsvImporter } from './RevolutCsvImporter'

const kindLabels: Record<ImportedTransactionKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

function budgetMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function transactionSort(left: ImportedTransaction, right: ImportedTransaction) {
  return (
    right.bookingDate.localeCompare(left.bookingDate) ||
    left.description.localeCompare(right.description, 'en')
  )
}

export function TransactionsPage() {
  const {
    data,
    activeBudget,
    setTransactionCategory,
    setTransactionKind,
    deleteTransaction,
  } = useBudget()
  const [selectedMonth, setSelectedMonth] = useState(() =>
    budgetMonthKey(activeBudget.year, activeBudget.month),
  )

  const months = useMemo(() => {
    const keys = new Set(
      data.budgetMonths.map((budget) =>
        budgetMonthKey(budget.year, budget.month),
      ),
    )
    data.importedTransactions.forEach((transaction) =>
      keys.add(transaction.bookingDate.slice(0, 7)),
    )
    return [...keys].sort().reverse()
  }, [data.budgetMonths, data.importedTransactions])

  const budget = data.budgetMonths.find(
    (candidate) =>
      budgetMonthKey(candidate.year, candidate.month) === selectedMonth,
  )
  const transactions = useMemo(
    () =>
      data.importedTransactions
        .filter((transaction) =>
          transaction.bookingDate.startsWith(selectedMonth),
        )
        .sort(transactionSort),
    [data.importedTransactions, selectedMonth],
  )

  const euroTransactions = transactions.filter(
    (transaction) => transaction.currency === 'EUR',
  )
  const actualExpenseCents = euroTransactions.reduce(
    (total, transaction) =>
      total +
      transaction.feeCents +
      (transaction.kind === 'expense' && transaction.amountCents < 0
        ? -transaction.amountCents
        : 0),
    0,
  )
  const actualIncomeCents = euroTransactions.reduce(
    (total, transaction) =>
      transaction.kind === 'income' && transaction.amountCents > 0
        ? total + transaction.amountCents
        : total,
    0,
  )
  const plannedExpenseCents =
    budget?.expenseCategories.reduce(
      (categoryTotal, category) =>
        categoryTotal +
        category.items.reduce(
          (itemTotal, item) => itemTotal + item.amountCents,
          0,
        ),
      0,
    ) ?? 0
  const unclassifiedCount = transactions.filter(
    (transaction) =>
      transaction.kind === 'expense' && transaction.categoryId === null,
  ).length
  const nonEuroCount = transactions.length - euroTransactions.length

  const removeTransaction = (transaction: ImportedTransaction) => {
    if (
      window.confirm(
        `Delete “${transaction.description}” from ${transaction.bookingDate}?`,
      )
    ) {
      deleteTransaction(transaction.id)
    }
  }

  return (
    <main className="content-page transactions-page">
      <div className="transactions-intro">
        <div className="page-intro">
          <p className="eyebrow">Actual expenses</p>
          <h1>Revolut transactions</h1>
          <p>
            Import a CSV statement, review the new rows, then assign expenses
            to categories in the matching budget.
          </p>
        </div>
        <label className="month-filter">
          <span>Displayed month</span>
          <select
            aria-label="Transaction month"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
          >
            {months.map((month) => (
              <option key={month} value={month}>
                {formatMonthKey(month)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <RevolutCsvImporter onImported={setSelectedMonth} />

      <section
        className="transaction-summary-grid"
        aria-label={`Transaction summary for ${formatMonthKey(selectedMonth)}`}
      >
        <article>
          <span>Actual expenses</span>
          <strong>{formatMoney(actualExpenseCents)}</strong>
          <small>EUR transactions classified as expenses, including fees</small>
        </article>
        <article>
          <span>Planned budget</span>
          <strong>{formatMoney(plannedExpenseCents)}</strong>
          <small>
            {budget ? budget.name : 'No budget for this month'}
          </small>
        </article>
        <article
          className={
            actualExpenseCents > plannedExpenseCents ? 'is-negative' : ''
          }
        >
          <span>Available difference</span>
          <strong>{formatMoney(plannedExpenseCents - actualExpenseCents)}</strong>
          <small>Planned minus actual expenses</small>
        </article>
        <article className={unclassifiedCount > 0 ? 'needs-attention' : ''}>
          <span>To classify</span>
          <strong>{unclassifiedCount}</strong>
          <small>
            {actualIncomeCents > 0
              ? `${formatMoney(actualIncomeCents)} of EUR income`
              : 'No EUR income'}
          </small>
        </article>
      </section>

      {nonEuroCount > 0 && (
        <div className="warning-panel transaction-warning">
          <div className="warning-icon" aria-hidden="true">
            !
          </div>
          <div>
            <h2>Multiple currencies</h2>
            <p>
              {nonEuroCount} {nonEuroCount === 1 ? 'transaction is' : 'transactions are'}{' '}
              excluded from EUR totals. The original amount remains visible below.
            </p>
          </div>
        </div>
      )}

      {!budget && transactions.length > 0 && (
        <div className="warning-panel transaction-warning">
          <div className="warning-icon" aria-hidden="true">
            !
          </div>
          <div>
            <h2>No budget for {formatMonthKey(selectedMonth)}</h2>
            <p>
              Transactions are retained, but their categories can only be
              assigned after you create this month on the Budget screen.
            </p>
          </div>
        </div>
      )}

      <section className="transactions-card" aria-labelledby="transactions-title">
        <div className="transactions-card-heading">
          <div>
            <p className="eyebrow">Imported history</p>
            <h2 id="transactions-title">
              {formatMonthKey(selectedMonth)}
            </h2>
          </div>
          <span>
            {transactions.length}{' '}
            {transactions.length === 1 ? 'transaction' : 'transactions'}
          </span>
        </div>

        {transactions.length === 0 ? (
          <div className="transaction-empty">
            <div aria-hidden="true">
              <Download size={23} />
            </div>
            <h3>No transactions for this month</h3>
            <p>
              Choose a Revolut CSV export. Previously imported files can be
              selected again without creating duplicates.
            </p>
          </div>
        ) : (
          <div className="table-scroll transactions-table">
            <table>
              <thead>
                <tr>
                  <th>Date and description</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => {
                  const canCategorize =
                    transaction.kind === 'expense' &&
                    Boolean(budget?.expenseCategories.length)
                  return (
                    <tr key={transaction.id}>
                      <td data-label="Transaction">
                        <div className="transaction-description">
                          <time dateTime={transaction.bookingDate}>
                            {formatTransactionDate(transaction.bookingDate)}
                          </time>
                          <div>
                            <strong>{transaction.description}</strong>
                            <span>
                              {transaction.transactionType ?? 'Unknown type'}
                              {transaction.feeCents > 0
                                ? ` · fee ${formatTransactionAmount(
                                    transaction.feeCents,
                                    transaction.currency,
                                  )}`
                                : ''}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Type">
                        <select
                          aria-label={`Type for ${transaction.description}`}
                          value={transaction.kind}
                          onChange={(event) =>
                            setTransactionKind(
                              transaction.id,
                              event.target.value as ImportedTransactionKind,
                            )
                          }
                        >
                          {(Object.keys(kindLabels) as ImportedTransactionKind[]).map(
                            (kind) => (
                              <option key={kind} value={kind}>
                                {kindLabels[kind]}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td data-label="Category">
                        <select
                          aria-label={`Category for ${transaction.description}`}
                          value={
                            canCategorize
                              ? (transaction.categoryId ?? '')
                              : ''
                          }
                          disabled={!canCategorize}
                          onChange={(event) =>
                            setTransactionCategory(
                              transaction.id,
                              event.target.value || null,
                            )
                          }
                        >
                          <option value="">
                            {transaction.kind !== 'expense'
                              ? 'Not applicable'
                              : budget
                                ? 'To classify'
                                : 'No budget'}
                          </option>
                          {budget?.expenseCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td
                        data-label="Amount"
                        className={
                          transaction.amountCents < 0
                            ? 'transaction-debit'
                            : 'transaction-credit'
                        }
                      >
                        {formatTransactionAmount(
                          transaction.amountCents,
                          transaction.currency,
                        )}
                      </td>
                      <td className="transaction-actions-cell">
                        <button
                          type="button"
                          className="transaction-delete"
                          aria-label={`Delete ${transaction.description}`}
                          onClick={() => removeTransaction(transaction)}
                        >
                          <Trash2 aria-hidden="true" size={17} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
