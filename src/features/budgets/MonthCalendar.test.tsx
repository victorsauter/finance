import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthCalendar, type MonthCalendarProps } from './MonthCalendar'

afterEach(cleanup)

function renderCalendar(overrides: Partial<MonthCalendarProps> = {}) {
  const props: MonthCalendarProps = {
    year: 2026,
    onYearChange: vi.fn(),
    selectedKey: '2026-08',
    currentKey: '2026-03',
    savedKeys: ['2026-03', '2026-08', '2025-12'],
    onSelect: vi.fn(),
    ...overrides,
  }
  render(<MonthCalendar {...props} />)
  return props
}

describe('MonthCalendar', () => {
  it('shows the 12 months of the displayed year', () => {
    renderCalendar()

    const grid = screen.getByRole('group', { name: 'Months of 2026' })
    expect(within(grid).getAllByRole('button')).toHaveLength(12)
    expect(screen.getByRole('button', { name: 'January 2026' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'December 2026' })).toBeVisible()
    expect(screen.getByTestId('calendar-year')).toHaveTextContent('2026')
  })

  it('marks the selected, current and saved months', () => {
    renderCalendar()

    const selected = screen.getByRole('button', { name: 'August 2026' })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(selected).toHaveAttribute('data-saved', 'true')
    expect(selected).not.toHaveAttribute('aria-current')

    const current = screen.getByRole('button', { name: 'March 2026' })
    expect(current).toHaveAttribute('aria-current', 'date')
    expect(current).toHaveAttribute('aria-pressed', 'false')
    expect(current).toHaveAttribute('data-saved', 'true')

    const empty = screen.getByRole('button', { name: 'May 2026' })
    expect(empty).not.toHaveAttribute('data-saved')
    expect(empty).toHaveAttribute('aria-pressed', 'false')
    // Saved months of other years are not marked on this year.
    expect(
      screen.getByRole('button', { name: 'December 2026' }),
    ).not.toHaveAttribute('data-saved')
  })

  it('steps the displayed year without selecting a month', async () => {
    const user = userEvent.setup()
    const props = renderCalendar()

    await user.click(screen.getByRole('button', { name: 'Next year' }))
    expect(props.onYearChange).toHaveBeenLastCalledWith(2027)
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(props.onYearChange).toHaveBeenLastCalledWith(2025)
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('selects any month, saved or not, of the displayed year', async () => {
    const user = userEvent.setup()
    const props = renderCalendar({ year: 2031 })

    await user.click(screen.getByRole('button', { name: 'February 2031' }))

    expect(props.onSelect).toHaveBeenCalledWith(2031, 2)
  })

  it('keeps touch targets at least 44px tall', () => {
    renderCalendar()

    // h-11 = 2.75rem = 44px at the default root size.
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toMatch(/\b(h-11|size-11)\b/)
    }
  })
})
