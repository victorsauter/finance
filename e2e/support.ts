import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Isolated fake Auth/Data API: tests never send email or personal budgets to
 * the production project. PostgreSQL/RLS is tested separately in supabase/tests.
 */
export async function fakeCloud(page: Page) {
  let document: unknown = null
  let revision = 0
  let writes = 0
  const user = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'pilot@example.invalid',
    aud: 'authenticated',
    role: 'authenticated',
    created_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
  }
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: user.id,
    aud: user.aud,
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: user.role,
  })}.test-signature`
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    if (url.pathname === '/auth/v1/otp' || url.pathname === '/auth/v1/logout')
      return respond({})
    if (url.pathname === '/auth/v1/verify')
      return respond({
        access_token: token,
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      })
    if (url.pathname === '/auth/v1/user') return respond(user)
    if (url.pathname === '/rest/v1/finance_documents')
      return respond(document ? [{ data: document, revision }] : [])
    if (url.pathname === '/rest/v1/rpc/save_finance_document') {
      const input = route.request().postDataJSON()
      if (input.expected_revision !== revision)
        return respond({ status: 'conflict', revision })
      document = input.document
      writes += 1
      revision += 1
      return respond({ status: 'saved', revision })
    }
    return respond(
      { message: `Unexpected test request: ${url.pathname}` },
      500,
    )
  })
  return { getWrites: () => writes }
}

export async function signIn(page: Page) {
  await page.goto('/account')
  await page.getByLabel('Email address').fill('pilot@example.invalid')
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await page.getByLabel('Email code').fill('123456')
  await page.getByRole('button', { name: 'Verify code' }).click()
  await expect(
    page.getByRole('heading', { name: 'pilot@example.invalid' }),
  ).toBeVisible()
}

/** Sets a money field and leaves it, which commits the value. */
export async function commit(field: Locator, value: string) {
  await field.fill(value)
  await field.press('Tab')
}

/**
 * Waits until the local save indicator of the shell (sidebar on desktop, header
 * on mobile) reports "Saved locally". The indicator is an icon with an
 * aria-label when compact and an icon plus text otherwise.
 */
export async function expectSaved(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const indicators = [
          ...document.querySelectorAll('[title="Local save status"]'),
        ].filter((el) => el.checkVisibility())
        return indicators.map(
          (el) => el.getAttribute('aria-label') ?? el.textContent?.trim(),
        )
      }),
    )
    .toContain('Saved locally')
}

/** English month name with year, as the app writes it: "August 2030". */
export function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1))
}

/** The calendar month the browser is in now, e.g. { year: 2026, month: 11 }. */
export function today() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** The button that opens the month calendar: it is named after the month. */
export function monthTrigger(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true })
}

/** The month calendar popover, once opened. */
export function calendar(page: Page) {
  return page.getByRole('dialog').filter({
    has: page.getByRole('button', { name: 'Previous year' }),
  })
}

async function showYear(page: Page, year: number) {
  const popover = calendar(page)
  await expect(popover).toBeVisible()
  for (let guard = 0; guard < 40; guard++) {
    const shown = Number(
      await popover.getByTestId('calendar-year').textContent(),
    )
    if (shown === year) return popover
    await popover
      .getByRole('button', {
        name: shown < year ? 'Next year' : 'Previous year',
      })
      .click()
  }
  throw new Error(`Could not reach year ${year} in the calendar`)
}

/**
 * Opens a month through the calendar popover: opens it from the trigger (named
 * after the month shown now), moves to the year, picks the month.
 */
export async function openMonthViaCalendar(
  page: Page,
  current: string,
  year: number,
  monthName: string,
) {
  await monthTrigger(page, current).click()
  const popover = await showYear(page, year)
  await popover
    .getByRole('group', { name: `Months of ${year}` })
    .getByRole('button', { name: `${monthName} ${year}`, exact: true })
    .click()
  await expect(popover).toHaveCount(0)
}

/** Names of the calendar months of `year` that hold saved data. */
export async function savedMonths(page: Page, current: string, year: number) {
  await monthTrigger(page, current).click()
  const popover = await showYear(page, year)
  const names = await popover
    .getByRole('group', { name: `Months of ${year}` })
    .locator('button[data-saved="true"]')
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label')))
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  return names
}
