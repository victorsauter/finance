import Dexie from 'dexie'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'

function renderApp() {
  return render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

beforeEach(async () => {
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
  await Dexie.delete('mon-budget')
})

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  cleanup()
})

describe('budget application', () => {
  it('opens local data during React strict mode lifecycle checks', async () => {
    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Construire le mois' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/DatabaseClosedError/),
    ).not.toBeInTheDocument()
  })

  it('creates a local month and updates totals after editing income', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Construire le mois' }),
    ).toBeInTheDocument()

    const incomeInput = screen.getByLabelText('Montant de Revenu principal')
    await user.clear(incomeInput)
    await user.type(incomeInput, '3000,50')
    await user.tab()

    const summary = screen.getByRole('region', { name: 'Résumé du budget' })
    const incomeCard = within(summary).getByText('Revenus').closest('article')
    expect(incomeCard).not.toBeNull()
    expect(incomeCard).toHaveTextContent('3 000,50 €')
    await waitFor(() =>
      expect(screen.getByText('Enregistré localement')).toBeInTheDocument(),
    )
  })

  it('opens the backup screen from the main navigation', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: 'Construire le mois' })

    const navigation = screen.getByRole('navigation', {
      name: 'Navigation principale',
    })
    await user.click(within(navigation).getByRole('link', { name: 'Sauvegarde' }))

    expect(
      await screen.findByRole('heading', {
        name: 'Sauvegarde et restauration',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Télécharger le JSON' }),
    ).toBeInTheDocument()
  })

  it('persists a manual dark appearance', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: 'Construire le mois' })

    const appearance = screen.getAllByRole('group', {
      name: 'Apparence',
    })[0]!
    await user.click(
      within(appearance).getByRole('button', { name: 'Thème sombre' }),
    )

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('mon-budget-theme')).toBe('dark')
  })

  it('previews, imports, classifies, and deduplicates a Revolut CSV', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: 'Construire le mois' })

    const navigation = screen.getByRole('navigation', {
      name: 'Navigation principale',
    })
    await user.click(
      within(navigation).getByRole('link', { name: 'Opérations' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Opérations Revolut' }),
    ).toBeInTheDocument()

    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const date = `${now.getFullYear()}-${month}-15`
    const csv = [
      'Started Date,Completed Date,Description,Amount,Type,Product,State,Currency,Reference',
      `${date},${date},Supermarché,-42.50,card payment,Current,COMPLETED,EUR,expense-1`,
      `${date},${date},Salaire,2500,bank transfer,Current,COMPLETED,EUR,income-1`,
      `${date},,Café,-3.20,card payment,Current,PENDING,EUR,pending-1`,
    ].join('\n')
    const file = new File([csv], 'revolut.csv', { type: 'text/csv' })

    await user.upload(screen.getByLabelText('Fichier CSV Revolut'), file)
    const importButton = await screen.findByRole('button', {
      name: 'Importer 2 opérations',
    })
    expect(screen.getByText('1', { selector: '.import-stats strong' })).toBeInTheDocument()
    await user.click(importButton)

    expect(await screen.findByText('Supermarché')).toBeInTheDocument()
    const expenseSummary = screen
      .getByText('Dépenses réelles', { selector: 'span' })
      .closest('article')
    expect(expenseSummary).toHaveTextContent('42,50 €')

    const categorySelect = screen.getByLabelText('Catégorie de Supermarché')
    await user.selectOptions(
      categorySelect,
      within(categorySelect).getByRole('option', { name: 'Logement' }),
    )
    await waitFor(() =>
      expect(screen.getByText('Enregistré localement')).toBeInTheDocument(),
    )

    await user.upload(screen.getByLabelText('Fichier CSV Revolut'), file)
    expect(
      await screen.findByRole('button', {
        name: 'Importer 0 opérations',
      }),
    ).toBeDisabled()
  })
})
