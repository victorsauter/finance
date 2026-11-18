import Dexie from 'dexie'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'

beforeEach(async () => {
  window.localStorage.clear()
  await Dexie.delete('finance')
})

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  cleanup()
})

function openApp(url: string) {
  window.history.replaceState({}, '', url)
  return render(<App />)
}

describe('budget route and the `m` search param', () => {
  it('shows the month of the URL, even when it has no data yet', async () => {
    openApp('/?m=2030-08')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'August 2030' }),
    ).toBeInTheDocument()
    expect(window.location.search).toBe('?m=2030-08')
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument()
  })

  it('writes the active month into the URL when `m` is missing', async () => {
    openApp('/')

    await screen.findByRole('heading', { level: 1 })
    const now = new Date()
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    await waitFor(() => expect(window.location.search).toBe(`?m=${key}`))
  })

  it('steps by calendar month with the chevrons, across a year boundary', async () => {
    const user = userEvent.setup()
    openApp('/?m=2030-01')
    await screen.findByRole('heading', { level: 1, name: 'January 2030' })

    await user.click(screen.getByRole('button', { name: 'Previous month' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'December 2029' }),
    ).toBeInTheDocument()
    expect(window.location.search).toBe('?m=2029-12')

    await user.click(screen.getByRole('button', { name: 'Next month' }))
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'February 2030' }),
    ).toBeInTheDocument()
    expect(window.location.search).toBe('?m=2030-02')
  })

  it('picks any month of any year from the calendar', async () => {
    const user = userEvent.setup()
    openApp('/?m=2030-08')
    await screen.findByRole('heading', { level: 1, name: 'August 2030' })

    await user.click(screen.getByRole('button', { name: 'August 2030' }))
    const calendar = await screen.findByRole('group', {
      name: 'Months of 2030',
    })
    expect(
      within(calendar).getByRole('button', { name: 'August 2030' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Next year' }))
    await user.click(screen.getByRole('button', { name: 'March 2031' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'March 2031' }),
    ).toBeInTheDocument()
    expect(window.location.search).toBe('?m=2031-03')
    // The popover closes after a pick.
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: /Months of/ }),
      ).not.toBeInTheDocument(),
    )
  })

  it('saves a virtual month only on the first edit', async () => {
    const user = userEvent.setup()
    openApp('/?m=2030-08')
    await screen.findByRole('heading', { level: 1, name: 'August 2030' })

    await user.click(screen.getByRole('button', { name: 'August 2030' }))
    const before = await screen.findByRole('group', { name: 'Months of 2030' })
    expect(
      within(before).getByRole('button', { name: 'August 2030' }),
    ).not.toHaveAttribute('data-saved')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Months of 2030' }),
      ).not.toBeInTheDocument(),
    )

    const income = screen.getByLabelText('Amount for Main income')
    await user.clear(income)
    await user.type(income, '1000')
    await user.tab()

    await waitFor(() =>
      expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'August 2030' }))
    const grid = await screen.findByRole('group', { name: 'Months of 2030' })
    expect(
      within(grid).getByRole('button', { name: 'August 2030' }),
    ).toHaveAttribute('data-saved', 'true')
  })

  it('offers rename and reset in the actions menu', async () => {
    const user = userEvent.setup()
    openApp('/?m=2030-08')
    await screen.findByRole('heading', { level: 1, name: 'August 2030' })

    await user.click(screen.getByRole('button', { name: 'Budget actions' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Rename month',
      'Reset month',
    ])
  })

  it('renames the month and saves it', async () => {
    const user = userEvent.setup()
    openApp('/?m=2030-08')
    await screen.findByRole('heading', { level: 1, name: 'August 2030' })

    await user.click(screen.getByRole('button', { name: 'Budget actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename month' }))
    const field = await screen.findByLabelText('Month name')
    await user.clear(field)
    await user.type(field, 'Holiday month')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Holiday month' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument(),
    )
  })

  it('ignores a month outside the supported years', async () => {
    openApp('/?m=0001-05')

    // The invalid param is dropped: a real month is shown, never year 1.
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(String(new Date().getFullYear()))
    expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument()
  })
})
