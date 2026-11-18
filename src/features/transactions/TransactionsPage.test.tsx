import Dexie from 'dexie'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'

const header =
  'Started Date,Completed Date,Description,Amount,Type,Product,State,Currency,Reference'

function csvFile(...rows: string[]) {
  return new File([[header, ...rows].join('\n')], 'revolut.csv', {
    type: 'text/csv',
  })
}

const marchAndApril = csvFile(
  '2025-03-10,2025-03-10,Boulangerie,-4.50,card payment,Current,COMPLETED,EUR,mar-1',
  '2025-03-12,2025-03-12,Pharmacie,-12.00,card payment,Current,COMPLETED,EUR,mar-2',
  '2025-04-02,2025-04-02,Librairie,-20.00,card payment,Current,COMPLETED,EUR,apr-1',
)

async function importFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(screen.getByLabelText('Revolut CSV file'), file)
  await user.click(
    await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }),
  )
}

beforeEach(async () => {
  window.history.replaceState({}, '', '/transactions?m=2025-03')
  window.localStorage.clear()
  await Dexie.delete('finance')
})

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  cleanup()
})

describe('transactions page month filter', () => {
  it('shows the month from the m search param and follows the selector', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Revolut transactions' })

    expect(screen.getByLabelText('Transaction month')).toHaveValue('2025-03')
    expect(
      screen.getByRole('heading', { name: 'No transactions for this month' }),
    ).toBeInTheDocument()

    await importFile(user, marchAndApril)

    // The import jumps to the most recent imported month and updates `m`.
    await waitFor(() => expect(window.location.search).toBe('?m=2025-04'))
    expect(screen.getByLabelText('Transaction month')).toHaveValue('2025-04')
    expect(await screen.findByLabelText('Category for Librairie')).toBeVisible()
    expect(
      screen.queryByLabelText('Category for Boulangerie'),
    ).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Transaction month'), '2025-03')

    await waitFor(() => expect(window.location.search).toBe('?m=2025-03'))
    expect(await screen.findByLabelText('Category for Boulangerie')).toBeVisible()
    expect(screen.getByLabelText('Category for Pharmacie')).toBeVisible()
    expect(
      screen.queryByLabelText('Category for Librairie'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', {
        name: 'Transaction summary for March 2025',
      }),
    ).toBeInTheDocument()
  })

  it('sorts by date, newest first, and can reverse', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Revolut transactions' })
    await importFile(user, marchAndApril)
    await user.selectOptions(screen.getByLabelText('Transaction month'), '2025-03')
    await screen.findByLabelText('Category for Boulangerie')

    const order = () =>
      screen
        .getAllByLabelText(/^Category for /)
        .map((select) => select.getAttribute('aria-label'))

    expect(order()).toEqual([
      'Category for Pharmacie',
      'Category for Boulangerie',
    ])
    await user.click(
      screen.getByRole('button', { name: /Sort by date: Newest first/ }),
    )
    expect(order()).toEqual([
      'Category for Boulangerie',
      'Category for Pharmacie',
    ])
  })
})

describe('transactions page without a budget for the month', () => {
  it('offers to open the month on the budget screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Revolut transactions' })
    await importFile(user, marchAndApril)
    await user.selectOptions(screen.getByLabelText('Transaction month'), '2025-03')

    const link = await screen.findByRole('link', { name: 'Open this month' })
    expect(link).toHaveAttribute('href', '/?m=2025-03')
    expect(screen.getByLabelText('Category for Boulangerie')).toBeDisabled()

    await user.click(link)

    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(window.location.search).toBe('?m=2025-03')
  })
})
