import { expect, test } from '@playwright/test'
import { commit, expectSaved, fakeCloud, signIn } from './support'


test('sign-in preserves guest data, requires import consent and isolates sign-out', async ({ page }) => {
  const server = await fakeCloud(page)
  await page.goto('/')
  await commit(page.getByLabel('Amount for Main income'), '2468.12')
  await expectSaved(page)

  await signIn(page)
  await expect(page.getByRole('button', { name: 'Import guest budgets and enable sync' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('account-onboarding.png'), fullPage: true })
  expect(server.getWrites()).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.getByRole('button', { name: 'Import guest budgets and enable sync' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(server.getWrites()).toBe(0)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Import guest budgets and enable sync' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Upload and enable sync' }).click()
  expect((await download).suggestedFilename()).toBe('finance-before-cloud-import.json')
  await expect(page.getByText('Sync status: synced.', { exact: true })).toBeVisible()
  expect(server.getWrites()).toBe(1)
  await page.goto('/')
  await expect(page.getByLabel('Amount for Main income')).toHaveValue('2468.12')
  await commit(page.getByLabel('Amount for Main income'), '3000')
  await expect.poll(server.getWrites).toBe(2)

  await page.goto('/account')
  await page.getByRole('button', { name: 'Sign out on this device' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByLabel('Amount for Main income')).toHaveValue('2468.12')
  await signIn(page)
  await expect(page.getByText('Sync status: synced.', { exact: true })).toBeVisible()
  await page.goto('/')
  await expect(page.getByLabel('Amount for Main income')).toHaveValue('3000.00')
})

test('failed authentication stays in guest mode without uploading budgets', async ({ page }) => {
  const server = await fakeCloud(page)
  await page.route('https://*.supabase.co/auth/v1/otp**', (route) => route.fulfill({ status: 429,
    contentType: 'application/json', body: JSON.stringify({ msg: 'Email rate limit exceeded' }) }))
  await page.goto('/account')
  await page.getByLabel('Email address').fill('pilot@example.invalid')
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('alert')).toContainText('Email rate limit exceeded')
  await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible()
  expect(server.getWrites()).toBe(0)
})

test('prevents two tabs from editing the same account cache', async ({ page, context }) => {
  await fakeCloud(page)
  await signIn(page)
  const second = await context.newPage()
  await fakeCloud(second)
  await second.goto('/account')
  await expect(second.getByRole('heading', { name: 'Account already open in another tab' })).toBeVisible()
  await page.close()
  await second.getByRole('button', { name: 'Reload this tab' }).click()
  await expect(second.getByRole('heading', { name: 'pilot@example.invalid' })).toBeVisible()
})
