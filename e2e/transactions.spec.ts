import { expect, test } from '@playwright/test'
import { expectSaved, monthLabel, today } from './support'

const { year, month } = today()
const mm = String(month).padStart(2, '0')
const date = `${year}-${mm}-15`

const csv = [
  'Started Date,Completed Date,Description,Amount,Type,Product,State,Currency,Reference',
  `${date},${date},Supermarché,-42.50,card payment,Current,COMPLETED,EUR,expense-1`,
  `${date},${date},Salaire,2500,bank transfer,Current,COMPLETED,EUR,income-1`,
  `${date},,Café,-3.20,card payment,Current,PENDING,EUR,pending-1`,
].join('\n')

const file = { name: 'revolut.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }

test('imports a Revolut CSV once and preserves classification', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revolut transactions')
  await page.getByLabel('Revolut CSV file').setInputFiles(file)

  const summary = page.getByRole('group', { name: 'Import summary' })
  await expect(summary).toBeVisible()
  // New, duplicates, pending, excluded.
  await expect(summary.getByText('New').locator('xpath=preceding-sibling::strong')).toHaveText('2')
  await expect(summary.getByText('Pending').locator('xpath=preceding-sibling::strong')).toHaveText('1')

  await page.getByRole('button', { name: 'Import 2 transactions' }).click()
  await expect(page.getByText('Supermarché')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Actual expenses' })).toContainText('42.50')
  await expect(page.getByRole('article', { name: 'To classify' })).toContainText('1')

  await page.getByLabel('Category for Supermarché').selectOption({ label: 'Housing' })
  await expect(page.getByRole('article', { name: 'To classify' })).toContainText('0')
  await expectSaved(page)

  await page.reload()
  await expect(page.getByText('Supermarché')).toBeVisible()
  await expect(page.getByLabel('Category for Supermarché')).toHaveValue(/.+/)
  await expect(
    page.getByLabel('Category for Supermarché').locator('option:checked'),
  ).toHaveText('Housing')

  // Choosing the same file again creates no duplicates.
  await page.getByLabel('Revolut CSV file').setInputFiles(file)
  await expect(page.getByRole('button', { name: 'Import 0 transactions' })).toBeDisabled()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false)
})

test('offers to open a month that has transactions but no budget', async ({ page }) => {
  // A past month with an imported expense and no budget behind it.
  const pastDate = '2029-02-10'
  const pastCsv = [
    'Started Date,Completed Date,Description,Amount,Type,Product,State,Currency,Reference',
    `${pastDate},${pastDate},Bakery,-6.80,card payment,Current,COMPLETED,EUR,past-1`,
  ].join('\n')
  await page.goto('/transactions')
  await page.getByLabel('Revolut CSV file').setInputFiles({
    name: 'past.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(pastCsv),
  })
  await page.getByRole('button', { name: 'Import 1 transaction' }).click()
  await expect(page).toHaveURL(/[?&]m=2029-02$/)
  await expect(page.getByText('Bakery')).toBeVisible()
  await expect(page.getByText(`No budget for ${monthLabel(2029, 2)}`)).toBeVisible()

  await page.getByRole('link', { name: 'Open this month' }).click()
  await expect(page).toHaveURL(/\/\?m=2029-02$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('February 2029')
})
