import { expect, test } from '@playwright/test'
import {
  calendar,
  commit,
  expectSaved,
  monthLabel,
  monthTrigger,
  openMonthViaCalendar,
  savedMonths,
  today,
} from './support'

const now = today()
const thisMonth = monthLabel(now.year, now.month)

test('edits a budget and preserves it after reload', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Build your month' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(thisMonth)

  const income = page.getByLabel('Amount for Main income')
  await commit(income, '3500.50')

  const summary = page.getByRole('region', { name: 'Budget summary' })
  await expect(summary).toContainText('3,500.50')
  await expectSaved(page)

  await page.reload()
  await expect(income).toHaveValue('3500.50')
  await expect(summary).toContainText('3,500.50')
})

test('writes the active month into the address and keeps it on reload', async ({
  page,
}) => {
  await page.goto('/')
  const key = `${now.year}-${String(now.month).padStart(2, '0')}`
  await expect(page).toHaveURL(new RegExp(`[?&]m=${key}$`))

  // A month named in the address wins over the last active one, and survives
  // a reload without flashing the previous month.
  await page.goto('/?m=2026-08')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'August 2026',
  )
  await page.reload()
  await expect(page).toHaveURL(/[?&]m=2026-08$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'August 2026',
  )
})

test('opens a future month from the calendar, edits it and keeps it after reload', async ({
  page,
}) => {
  await page.goto('/')
  await expect(monthTrigger(page, thisMonth)).toBeVisible()

  await openMonthViaCalendar(page, thisMonth, 2030, 'August')
  await expect(page).toHaveURL(/[?&]m=2030-08$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'August 2030',
  )
  // A month nobody edited yet only exists on screen.
  await expect(page.getByText(/Not saved yet/)).toBeVisible()

  await commit(page.getByLabel('Amount for Main income'), '4100')
  await expect(page.getByText(/Not saved yet/)).toHaveCount(0)
  await expectSaved(page)

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'August 2030',
  )
  await expect(page.getByLabel('Amount for Main income')).toHaveValue('4100.00')
  expect(await savedMonths(page, 'August 2030', 2030)).toEqual(['August 2030'])

  // The month it started from is untouched.
  await page.goto('/')
  await expect(page.getByLabel('Amount for Main income')).toHaveValue('4100.00')
})

test('does not save a month that was opened but never edited', async ({
  page,
}) => {
  await page.goto('/')
  await commit(page.getByLabel('Amount for Main income'), '2000')
  await expectSaved(page)

  // Look at another month through the calendar and leave it untouched.
  await openMonthViaCalendar(page, thisMonth, 2031, 'January')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'January 2031',
  )
  await expect(page.getByText(/Not saved yet/)).toBeVisible()
  // It starts from the plan of the nearest earlier month.
  await expect(page.getByLabel('Amount for Main income')).toHaveValue('2000.00')

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'January 2031',
  )
  await expect(page.getByText(/Not saved yet/)).toBeVisible()
  expect(await savedMonths(page, 'January 2031', 2031)).toEqual([])
  // Only the month that was really edited is saved.
  expect(await savedMonths(page, 'January 2031', now.year)).toEqual([
    thisMonth,
  ])

  // Stepping through months does not save them either.
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'February 2031',
  )
  await page.getByRole('button', { name: 'Previous month' }).click()
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'December 2030',
  )
  expect(await savedMonths(page, 'December 2030', 2030)).toEqual([])
  expect(await savedMonths(page, 'December 2030', 2031)).toEqual([])
})

test('calendar opens on the viewed year, steps through years and closes with Escape', async ({
  page,
}) => {
  await page.goto('/')
  await monthTrigger(page, thisMonth).click()
  const popover = calendar(page)
  await expect(popover.getByTestId('calendar-year')).toHaveText(
    String(now.year),
  )
  await expect(
    popover.getByRole('group', { name: `Months of ${now.year}` }),
  ).toBeVisible()
  await popover.getByRole('button', { name: 'Next year' }).click()
  await expect(popover.getByTestId('calendar-year')).toHaveText(
    String(now.year + 1),
  )
  await popover.getByRole('button', { name: 'Previous year' }).click()
  await popover.getByRole('button', { name: 'Previous year' }).click()
  await expect(popover.getByTestId('calendar-year')).toHaveText(
    String(now.year - 1),
  )
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
})

test('resets a saved month after confirmation', async ({ page }) => {
  await page.goto('/?m=2030-03')
  // A month that is not saved yet has nothing to reset.
  await page.getByRole('button', { name: 'Budget actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Reset month' })).toBeDisabled()
  await page.keyboard.press('Escape')

  const income = page.getByLabel('Amount for Main income')
  await commit(income, '1800')
  await page.getByRole('button', { name: 'Add income' }).click()
  await expectSaved(page)
  await expect(page.getByRole('textbox', { name: /^Income name/ })).toHaveCount(2)

  await page.getByRole('button', { name: 'Budget actions' }).click()
  await page.getByRole('menuitem', { name: 'Reset month' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Reset March 2030?')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /^Income name/ })).toHaveCount(2)

  await page.getByRole('button', { name: 'Budget actions' }).click()
  await page.getByRole('menuitem', { name: 'Reset month' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Reset month' })
    .click()
  // Back to the plan of the nearest earlier month (or an empty plan).
  await expect(page.getByRole('textbox', { name: /^Income name/ })).toHaveCount(1)
  await expect(page.getByLabel('Amount for Main income')).not.toHaveValue(
    '1800.00',
  )
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('March 2030')
})

test('keeps the page within the viewport after opening another month', async ({
  page,
}) => {
  await page.goto('/')
  await commit(page.getByLabel('Amount for Main income'), '2500')
  await openMonthViaCalendar(page, thisMonth, 2030, 'October')
  await expect(page.getByLabel('Amount for Main income')).toHaveValue('2500.00')
  const pageOverflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(pageOverflows).toBe(false)
})

test('reopens the installed application shell while offline', async ({
  context,
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  await context.setOffline(true)
  try {
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Build your month' }),
    ).toBeVisible()
    await expect(page.getByLabel('Offline').first()).toBeAttached()
  } finally {
    await context.setOffline(false)
  }
})

test('persists dark appearance and exposes adaptive navigation', async ({
  page,
  isMobile,
}) => {
  await page.goto('/')

  const appearance = page.getByRole('group', { name: 'Appearance' })
  await appearance.getByRole('button', { name: 'Dark theme' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  if (isMobile) {
    await expect(
      page.getByRole('navigation', { name: 'Mobile navigation' }),
    ).toBeVisible()
    await expect(page.locator('aside')).toBeHidden()
  } else {
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Mobile navigation' }),
    ).toBeHidden()
  }
})

test('keeps primary interactive targets at least 44 pixels', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Build your month' }),
  ).toBeVisible()
  const sizes = await page
    .locator(
      [
        'main button[aria-label="Previous month"]',
        'main button[aria-label="Next month"]',
        'main button[aria-label="Budget actions"]',
        'main header button',
        'aside nav a',
        'nav[aria-label="Mobile navigation"] a',
      ].join(', '),
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.checkVisibility())
        .map((element) => {
          const box = element.getBoundingClientRect()
          return { name: element.getAttribute('aria-label') ?? element.textContent, w: box.width, h: box.height }
        }),
    )

  expect(sizes.length).toBeGreaterThanOrEqual(4)
  for (const { name, w, h } of sizes) {
    expect(Math.min(w, h), name ?? 'target').toBeGreaterThanOrEqual(44)
  }
})
