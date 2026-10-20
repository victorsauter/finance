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
  expense: 'Dépense',
  income: 'Entrée',
  transfer: 'Transfert',
}

function budgetMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function transactionSort(left: ImportedTransaction, right: ImportedTransaction) {
  return (
    right.bookingDate.localeCompare(left.bookingDate) ||
    left.description.localeCompare(right.description, 'fr')
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
        `Supprimer l’opération « ${transaction.description} » du ${transaction.bookingDate} ?`,
      )
    ) {
      deleteTransaction(transaction.id)
    }
  }

  return (
    <main className="content-page transactions-page">
      <div className="transactions-intro">
        <div className="page-intro">
          <p className="eyebrow">Dépenses réelles</p>
          <h1>Opérations Revolut</h1>
          <p>
            Importez un relevé CSV, contrôlez les nouvelles lignes, puis
            classez les dépenses dans les catégories du budget correspondant.
          </p>
        </div>
        <label className="month-filter">
          <span>Mois affiché</span>
          <select
            aria-label="Mois des opérations"
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
        aria-label={`Résumé des opérations de ${formatMonthKey(selectedMonth)}`}
      >
        <article>
          <span>Dépenses réelles</span>
          <strong>{formatMoney(actualExpenseCents)}</strong>
          <small>Opérations EUR classées en dépenses, frais inclus</small>
        </article>
        <article>
          <span>Budget prévu</span>
          <strong>{formatMoney(plannedExpenseCents)}</strong>
          <small>
            {budget ? budget.name : 'Aucun budget pour ce mois'}
          </small>
        </article>
        <article
          className={
            actualExpenseCents > plannedExpenseCents ? 'is-negative' : ''
          }
        >
          <span>Écart disponible</span>
          <strong>{formatMoney(plannedExpenseCents - actualExpenseCents)}</strong>
          <small>Prévu moins dépenses réelles</small>
        </article>
        <article className={unclassifiedCount > 0 ? 'needs-attention' : ''}>
          <span>À classer</span>
          <strong>{unclassifiedCount}</strong>
          <small>
            {actualIncomeCents > 0
              ? `${formatMoney(actualIncomeCents)} d’entrées EUR`
              : 'Aucune entrée EUR'}
          </small>
        </article>
      </section>

      {nonEuroCount > 0 && (
        <div className="warning-panel transaction-warning">
          <div className="warning-icon" aria-hidden="true">
            !
          </div>
          <div>
            <h2>Devises multiples</h2>
            <p>
              {nonEuroCount} {nonEuroCount === 1 ? 'opération' : 'opérations'}{' '}
              hors EUR {nonEuroCount === 1 ? 'est exclue' : 'sont exclues'} des
              totaux. Le montant d’origine reste visible ci-dessous.
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
            <h2>Aucun budget pour {formatMonthKey(selectedMonth)}</h2>
            <p>
              Les opérations sont conservées, mais leurs catégories ne pourront
              être affectées qu’après création de ce mois dans l’écran Budget.
            </p>
          </div>
        </div>
      )}

      <section className="transactions-card" aria-labelledby="transactions-title">
        <div className="transactions-card-heading">
          <div>
            <p className="eyebrow">Historique importé</p>
            <h2 id="transactions-title">
              {formatMonthKey(selectedMonth)}
            </h2>
          </div>
          <span>
            {transactions.length}{' '}
            {transactions.length === 1 ? 'opération' : 'opérations'}
          </span>
        </div>

        {transactions.length === 0 ? (
          <div className="transaction-empty">
            <div aria-hidden="true">
              <Download size={23} />
            </div>
            <h3>Aucune opération pour ce mois</h3>
            <p>
              Choisissez un export CSV Revolut. Les fichiers déjà importés
              peuvent être sélectionnés sans créer de doublons.
            </p>
          </div>
        ) : (
          <div className="table-scroll transactions-table">
            <table>
              <thead>
                <tr>
                  <th>Date et libellé</th>
                  <th>Nature</th>
                  <th>Catégorie</th>
                  <th>Montant</th>
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
                      <td data-label="Opération">
                        <div className="transaction-description">
                          <time dateTime={transaction.bookingDate}>
                            {formatTransactionDate(transaction.bookingDate)}
                          </time>
                          <div>
                            <strong>{transaction.description}</strong>
                            <span>
                              {transaction.transactionType ?? 'Type inconnu'}
                              {transaction.feeCents > 0
                                ? ` · frais ${formatTransactionAmount(
                                    transaction.feeCents,
                                    transaction.currency,
                                  )}`
                                : ''}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Nature">
                        <select
                          aria-label={`Nature de ${transaction.description}`}
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
                      <td data-label="Catégorie">
                        <select
                          aria-label={`Catégorie de ${transaction.description}`}
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
                              ? 'Non applicable'
                              : budget
                                ? 'À classer'
                                : 'Budget absent'}
                          </option>
                          {budget?.expenseCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td
                        data-label="Montant"
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
                          aria-label={`Supprimer ${transaction.description}`}
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
