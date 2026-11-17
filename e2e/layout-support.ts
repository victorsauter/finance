// Shared by e2e/layout.spec.ts and scripts/capture-viewports.mjs.
// Plain JavaScript syntax on purpose (this file is also run by Node directly):
// inspectLayout is serialised into the page, so it must not use outside values.

/**
 * Runs in the page. Returns layout problems; an empty list means the layout is
 * clean. Overflow clipping would hide these problems, so it looks for them
 * explicitly: horizontal overflow, overlapping siblings, content leaving its
 * card, and overlapping Sankey labels.
 */
export function inspectLayout() {
  const problems = []
  const vw = document.documentElement.clientWidth
  const clips = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
        if (p === document.body || p === document.documentElement) return false
        return true
      }
    }
    return false
  }
  const label = (el) =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`

  if (document.documentElement.scrollWidth > vw) {
    problems.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`)
  }
  for (const el of document.querySelectorAll('main *')) {
    if (!el.checkVisibility()) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 1 && !clips(el)) {
      problems.push(`${label(el)} extends past the viewport (right ${Math.round(r.right)} > ${vw})`)
    }
  }
  const containers = '.workspace-grid, .summary-dashboard, .visualization-column, .summary-metrics, .transaction-summary-grid'
  for (const parent of document.querySelectorAll(containers)) {
    const kids = [...parent.children].filter((k) => k.checkVisibility())
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect()
        const b = kids[j].getBoundingClientRect()
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (overlapX > 1 && overlapY > 1) {
          problems.push(`${label(kids[i])} overlaps ${label(kids[j])} (${Math.round(overlapX)}x${Math.round(overlapY)}px)`)
        }
      }
    }
  }
  // Content must stay inside the card that holds it.
  const cards = '.editor-card, .chart-card, .allocation-card, .import-card, .transactions-card, .settings-card'
  for (const card of document.querySelectorAll(cards)) {
    const cr = card.getBoundingClientRect()
    for (const el of card.querySelectorAll('*')) {
      if (!el.checkVisibility() || (clips(el) && el.closest('.transactions-table'))) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > cr.right + 1) {
        problems.push(`${label(el)} sticks out of ${label(card)} (${Math.round(r.right - cr.right)}px)`)
      }
    }
  }
  // Sankey labels must not sit on top of each other.
  const labels = [...document.querySelectorAll('.sankey-node text')].map((t) => ({
    el: t,
    r: t.getBoundingClientRect(),
  }))
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i].r
      const b = labels[j].r
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ox > 1 && oy > 1) {
        problems.push(`sankey labels overlap ("${labels[i].el.textContent.slice(0, 24)}" / "${labels[j].el.textContent.slice(0, 24)}")`)
      }
    }
  }
  const canvas = document.querySelector('.app-canvas')
  if (canvas) {
    const c = canvas.getBoundingClientRect()
    for (const el of canvas.querySelectorAll('.content-page > *')) {
      const r = el.getBoundingClientRect()
      if (r.right > c.right + 1) problems.push(`${label(el)} wider than the content area`)
    }
  }
  return [...new Set(problems)]
}

/**
 * Fills the default budget with a realistic, busy one: long names, several
 * incomes, accounts and categories, so the editor and the Sankey are exercised
 * with more than a single income.
 */
export async function seedRichBudget(page) {
  const commit = async (locator, value) => {
    await locator.fill(value)
    await locator.press('Tab')
  }
  const add = page.getByRole('button', { name: 'Add', exact: true })

  await commit(page.locator('input[aria-label^="Income name"]').first(), 'Monthly salary from Example International Holdings')
  await commit(page.locator('input[aria-label^="Amount for"]').first(), '4200')
  await add.nth(0).click() // second income
  await commit(page.locator('input[aria-label^="Amount for"]').nth(1), '800')

  await add.nth(1).click() // two more accounts
  await add.nth(1).click()
  await commit(page.locator('input[aria-label^="Account name"]').nth(1), 'Joint account with a very long label')
  await commit(page.locator('input[aria-label^="Account name"]').nth(2), 'Savings')
  const transfers = page.locator('input[aria-label^="Transfer to"]')
  await commit(transfers.nth(0), '1800')
  await commit(transfers.nth(1), '1200')
  await commit(transfers.nth(2), '600')

  await page.getByRole('button', { name: 'Category' }).click()
  await page.getByRole('button', { name: 'Add expense' }).first().click()
  await page.getByRole('button', { name: 'Add expense' }).first().click()
  await commit(page.locator('input[aria-label^="Expense name"]').first(), 'Mortgage and home insurance payments')

  const amounts = page.locator('input[aria-label^="Amount for"]')
  const count = await amounts.count()
  for (let i = 2; i < count; i++) await commit(amounts.nth(i), String(90 + i * 35))
}
