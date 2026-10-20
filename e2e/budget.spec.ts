import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('edits a budget and preserves it after reload', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Build your month' }),
  ).toBeVisible()

  const income = page.getByLabel('Amount for Main income')
  await income.fill('3500.50')
  await income.press('Tab')

  const summary = page.getByRole('region', { name: 'Budget summary' })
  await expect(summary.locator('.summary-card').first()).toContainText(
    '3,500.50',
  )
  await expect(page.locator('.save-status:visible')).toHaveClass(/save-saved/)

  await page.reload()
  await expect(income).toHaveValue('3500.50')
  await expect(summary.locator('article').first()).toContainText('3,500.50')
})

test('duplicates a month and keeps the page within the mobile viewport', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByLabel('Amount for Main income').fill('2500')
  await page.getByLabel('Amount for Main income').press('Tab')
  const originalMonth = await page.getByLabel('Budget name').inputValue()
  await page.getByLabel('Budget actions').click()
  await page.getByRole('button', { name: 'Copy this month' }).click()

  await expect(page.getByLabel('Budget name')).not.toHaveValue(originalMonth)
  await expect(page.getByLabel('Amount for Main income')).toHaveValue(
    '2500.00',
  )
  const pageOverflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(pageOverflows).toBe(false)
})

test('downloads a versioned JSON backup', async ({ page }) => {
  await page.goto('/backup')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download JSON' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(
    /^finance-\d{4}-\d{2}-\d{2}\.json$/,
  )
})

test('imports a Revolut CSV once and preserves classification', async ({
  page,
}) => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const date = `${now.getFullYear()}-${month}-15`
  const csv = [
    'Started Date,Completed Date,Description,Amount,Type,Product,State,Currency,Reference',
    `${date},${date},Supermarché,-42.50,card payment,Current,COMPLETED,EUR,expense-1`,
    `${date},${date},Salaire,2500,bank transfer,Current,COMPLETED,EUR,income-1`,
    `${date},,Café,-3.20,card payment,Current,PENDING,EUR,pending-1`,
  ].join('\n')

  await page.goto('/transactions')
  await page.getByLabel('Revolut CSV file').setInputFiles({
    name: 'revolut.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })

  await expect(
    page.getByRole('button', { name: 'Import 2 transactions' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Import 2 transactions' }).click()
  await expect(page.getByText('Supermarché')).toBeVisible()
  await expect(
    page.locator('.transaction-summary-grid article').first(),
  ).toContainText('42.50')

  await page
    .getByLabel('Category for Supermarché')
    .selectOption({ label: 'Housing' })
  await expect(page.locator('.save-status:visible')).toHaveClass(/save-saved/)

  await page.reload()
  await expect(page.getByText('Supermarché')).toBeVisible()
  await expect(
    page.getByLabel('Category for Supermarché').locator('option:checked'),
  ).toHaveText('Housing')

  await page.getByLabel('Revolut CSV file').setInputFiles({
    name: 'revolut.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await expect(
    page.getByRole('button', { name: 'Import 0 transactions' }),
  ).toBeDisabled()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false)
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
    await expect(page.locator('.offline-pill:visible')).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})

test('persists dark appearance and exposes adaptive navigation', async ({
  page,
  isMobile,
}) => {
  await page.goto('/')

  const appearance = isMobile
    ? page.locator('.mobile-header').getByRole('group', { name: 'Appearance' })
    : page.locator('.desktop-sidebar').getByRole('group', {
        name: 'Appearance',
      })
  await appearance.getByRole('button', { name: 'Dark theme' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  if (isMobile) {
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
    await expect(page.locator('.desktop-sidebar')).toBeHidden()
  } else {
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
    await expect(page.locator('.mobile-dock')).toBeHidden()
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
      '.month-navigation button, .month-actions button, .sidebar-nav a, .mobile-dock a',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.checkVisibility())
        .map((element) => element.getBoundingClientRect().height),
    )

  expect(sizes.length).toBeGreaterThan(0)
  for (const height of sizes) {
    expect(height).toBeGreaterThanOrEqual(44)
  }
})

test('restores an exported budget only after confirmation', async ({ page }) => {
  await page.goto('/')
  const income = page.getByLabel('Amount for Main income')
  await income.fill('1234.56')
  await income.press('Tab')
  await expect(page.locator('.desktop-sidebar .save-status')).toHaveClass(/save-saved/)

  await page.goto('/backup')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download JSON' }).click()
  const download = await downloadPromise
  const file = await download.path()
  if (!file) throw new Error('The JSON backup was not saved')
  const contents = await readFile(file)
  const backup = JSON.parse(contents.toString('utf8'))
  expect(backup).toMatchObject({
    schemaVersion: 2,
    importedTransactions: [],
    budgetMonths: [expect.objectContaining({
      incomes: [expect.objectContaining({ amountCents: 123456 })],
    })],
  })

  await page.goto('/')
  await income.fill('99')
  await income.press('Tab')
  await expect(page.locator('.desktop-sidebar .save-status')).toHaveClass(/save-saved/)
  await page.goto('/backup')
  const cancelledDialog = page.waitForEvent('dialog')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: contents,
  })
  await (await cancelledDialog).dismiss()
  await page.goto('/')
  await expect(income).toHaveValue('99.00')

  await page.goto('/backup')
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('input[type="file"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: contents,
  })
  await expect(page.getByRole('status')).toContainText('have been restored')
  await page.goto('/')
  await expect(income).toHaveValue('1234.56')
  await page.reload()
  await expect(income).toHaveValue('1234.56')
})

test('serves an installable manifest and correctly sized PNG icons', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest).toMatchObject({
    name: 'Finance',
    display: 'standalone',
    start_url: '/',
    lang: 'en',
    icons: expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({
        sizes: '512x512',
        type: 'image/png',
        purpose: expect.stringMatching(/(^|\s)maskable(\s|$)/),
      }),
    ]),
  })

  for (const size of [192, 512]) {
    const icon = await request.get(`/finance-icon-${size}.png`)
    expect(icon.ok()).toBe(true)
    const png = await icon.body()
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(size)
    expect(png.readUInt32BE(20)).toBe(size)
  }
})
