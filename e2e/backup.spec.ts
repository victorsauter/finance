import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { commit, expectSaved } from './support'

test('downloads a versioned JSON backup', async ({ page }) => {
  await page.goto('/backup')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download JSON' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(
    /^finance-\d{4}-\d{2}-\d{2}\.json$/,
  )
  await expect(page.getByRole('status')).toContainText('has been downloaded')
})

test('restores an exported budget only after confirmation', async ({ page }) => {
  await page.goto('/')
  const income = page.getByLabel('Amount for Main income')
  await commit(income, '1234.56')
  await expectSaved(page)

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
    budgetMonths: [
      expect.objectContaining({
        incomes: [expect.objectContaining({ amountCents: 123456 })],
      }),
    ],
  })

  await page.goto('/')
  await commit(income, '99')
  await expectSaved(page)
  await page.goto('/backup')
  const backupFile = page.getByLabel('Backup file')
  await backupFile.setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: contents,
  })
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await page.goto('/')
  await expect(income).toHaveValue('99.00')

  await page.goto('/backup')
  await backupFile.setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: contents,
  })
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Replace data' })
    .click()
  await expect(page.getByRole('status')).toContainText('have been restored')
  await page.goto('/')
  await expect(income).toHaveValue('1234.56')
  await page.reload()
  await expect(income).toHaveValue('1234.56')
})

test('serves an installable manifest and correctly sized PNG icons', async ({
  request,
}) => {
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
