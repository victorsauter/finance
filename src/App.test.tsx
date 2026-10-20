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
  await Dexie.delete('finance')
})

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  cleanup()
})

describe('budget application', () => {
  it('opens local data during React strict mode lifecycle checks', async () => {
    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Build your month' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/DatabaseClosedError/),
    ).not.toBeInTheDocument()
  })

  it('creates a local month and updates totals after editing income', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Build your month' }),
    ).toBeInTheDocument()

    const incomeInput = screen.getByLabelText('Amount for Main income')
    await user.clear(incomeInput)
    await user.type(incomeInput, '3000,50')
    await user.tab()

    const summary = screen.getByRole('region', { name: 'Budget summary' })
    const incomeCard = within(summary).getByText('Income').closest('article')
    expect(incomeCard).not.toBeNull()
    expect(incomeCard).toHaveTextContent('€3,000.50')
    await waitFor(() =>
      expect(screen.getByText('Saved locally')).toBeInTheDocument(),
    )
  })

  it('opens the backup screen from the main navigation', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: 'Build your month' })

    const navigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    })
    await user.click(within(navigation).getByRole('link', { name: 'Backup' }))

    expect(
      await screen.findByRole('heading', {
        name: 'Backup and restore',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download JSON' }),
    ).toBeInTheDocument()
  })

  it('persists a manual dark appearance', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: 'Build your month' })

    const appearance = screen.getAllByRole('group', {
      name: 'Appearance',
    })[0]!
    await user.click(
      within(appearance).getByRole('button', { name: 'Dark theme' }),
    )

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('finance-theme')).toBe('dark')
  })

  it('previews, imports, classifies, and deduplicates a Revolut CSV', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('heading', { name: 'Build your month' })

    const navigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    })
    await user.click(
      within(navigation).getByRole('link', { name: 'Transactions' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Revolut transactions' }),
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

    await user.upload(screen.getByLabelText('Revolut CSV file'), file)
    const importButton = await screen.findByRole('button', {
      name: 'Import 2 transactions',
    })
    expect(screen.getByText('1', { selector: '.import-stats strong' })).toBeInTheDocument()
    await user.click(importButton)

    expect(await screen.findByText('Supermarché')).toBeInTheDocument()
    const expenseSummary = screen
      .getByText('Actual expenses', { selector: 'span' })
      .closest('article')
    expect(expenseSummary).toHaveTextContent('€42.50')

    const categorySelect = screen.getByLabelText('Category for Supermarché')
    await user.selectOptions(
      categorySelect,
      within(categorySelect).getByRole('option', { name: 'Housing' }),
    )
    await waitFor(() =>
      expect(screen.getByText('Saved locally')).toBeInTheDocument(),
    )

    await user.upload(screen.getByLabelText('Revolut CSV file'), file)
    expect(
      await screen.findByRole('button', {
        name: 'Import 0 transactions',
      }),
    ).toBeDisabled()
  })
})
