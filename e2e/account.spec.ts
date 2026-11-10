import { expect, test, type Page } from '@playwright/test'

// Isolated fake Auth/Data API: these tests never send email or personal budgets
// to the production project. PostgreSQL/RLS is tested separately in supabase/tests.
async function fakeCloud(page: Page) {
  let document: unknown = null
  let revision = 0
  let writes = 0
  const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'pilot@example.invalid',
    aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id,
    aud: user.aud, exp: Math.floor(Date.now() / 1000) + 3600, role: user.role })}.test-signature`
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const respond = (body: unknown, status = 200) => route.fulfill({ status,
      contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/auth/v1/otp' || url.pathname === '/auth/v1/logout') return respond({})
    if (url.pathname === '/auth/v1/verify') return respond({ access_token: token,
      refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, user })
    if (url.pathname === '/auth/v1/user') return respond(user)
    if (url.pathname === '/rest/v1/finance_documents') return respond(document
      ? [{ data: document, revision }] : [])
    if (url.pathname === '/rest/v1/rpc/save_finance_document') {
      const input = route.request().postDataJSON()
      if (input.expected_revision !== revision) return respond({ status: 'conflict', revision })
      document = input.document
      writes += 1
      revision += 1
      return respond({ status: 'saved', revision })
    }
    return respond({ message: `Unexpected test request: ${url.pathname}` }, 500)
  })
  return { getWrites: () => writes }
}

async function signIn(page: Page) {
  await page.goto('/account')
  await page.getByLabel('Email address').fill('pilot@example.invalid')
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await page.getByLabel('Email code').fill('123456')
  await page.getByRole('button', { name: 'Verify code' }).click()
  await expect(page.getByRole('heading', { name: 'pilot@example.invalid' })).toBeVisible()
}

test('sign-in preserves guest data, requires import consent and isolates sign-out', async ({ page }) => {
  const server = await fakeCloud(page)
  await page.goto('/')
  await page.getByLabel('Amount for Main income').fill('2468.12')
  await page.getByLabel('Amount for Main income').press('Tab')
  await expect(page.locator('.save-status:visible')).toHaveClass(/save-saved/)

  await signIn(page)
  await expect(page.getByRole('button', { name: 'Import guest budgets and enable sync' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('account-onboarding.png'), fullPage: true })
  expect(server.getWrites()).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Import guest budgets and enable sync' }).click()
  expect(server.getWrites()).toBe(0)

  page.once('dialog', (dialog) => dialog.accept())
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Import guest budgets and enable sync' }).click()
  expect((await download).suggestedFilename()).toBe('finance-before-cloud-import.json')
  await expect(page.getByText('Sync status: synced.', { exact: true })).toBeVisible()
  expect(server.getWrites()).toBe(1)
  await page.goto('/')
  await expect(page.getByLabel('Amount for Main income')).toHaveValue('2468.12')
  await page.getByLabel('Amount for Main income').fill('3000')
  await page.getByLabel('Amount for Main income').press('Tab')
  await expect.poll(server.getWrites).toBe(2)

  await page.goto('/account')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Sign out on this device' }).click()
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
