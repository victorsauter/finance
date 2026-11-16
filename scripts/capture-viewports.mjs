// Captures every page at a matrix of widths and themes, and reports layout
// problems that overflow-x clipping would otherwise hide.
//
// Usage: node scripts/capture-viewports.mjs [baseUrl] [outDir]
//   baseUrl defaults to http://127.0.0.1:5173 (npm run dev)
//   outDir  defaults to ./captures (git-ignored)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173'
const outDir = process.argv[3] ?? 'captures'
const widths = [360, 390, 768, 1024, 1180, 1200, 1240, 1280, 1440, 1920]
const themes = ['light', 'dark']
const pages = [
  ['budget', '/'],
  ['transactions', '/transactions'],
  ['backup', '/backup'],
  ['account', '/account'],
]

// Runs in the page. Returns problems; an empty list means the layout is clean.
function inspectLayout() {
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
      if (!el.checkVisibility() || clips(el) && el.closest('.chart-scroll, .transactions-table')) continue
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

async function seedRichBudget(page) {
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

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const report = []

for (const theme of themes) {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width < 700 ? 844 : 900 },
      deviceScaleFactor: 1,
      isMobile: width < 700,
      hasTouch: width < 700,
      serviceWorkers: 'block',
    })
    await context.addInitScript((value) => {
      try { window.localStorage.setItem('finance-theme', value) } catch { /* ignore */ }
    }, theme)
    const page = await context.newPage()
    page.on('pageerror', (error) => console.log(`page error @ ${width}px (${theme}): ${error.message}`))

    await page.goto(baseUrl + '/')
    await page.getByLabel('Amount for Main income').fill('3500')
    await page.getByLabel('Amount for Main income').press('Tab')

    for (const [name, path] of pages) {
      await page.goto(baseUrl + path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)
      const problems = await page.evaluate(inspectLayout)
      const file = `${name}-${width}-${theme}.png`
      await page.screenshot({ path: join(outDir, file), fullPage: true })
      report.push({ page: name, width, theme, problems })
    }

    // Busy budget: long names, several accounts and categories, so the Sankey
    // and the editor are checked with realistic content, not just one income.
    await page.goto(baseUrl + '/')
    await page.getByRole('heading', { name: 'Build your month' }).waitFor()
    await seedRichBudget(page)
    await page.waitForTimeout(500)
    const richProblems = await page.evaluate(inspectLayout)
    await page.screenshot({ path: join(outDir, `budget-rich-${width}-${theme}.png`), fullPage: true })
    report.push({ page: 'budget-rich', width, theme, problems: richProblems })
    await context.close()
  }
}
await browser.close()

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
const failing = report.filter((entry) => entry.problems.length > 0)
for (const entry of failing) {
  console.log(`\n${entry.page} @ ${entry.width}px (${entry.theme})`)
  for (const problem of entry.problems) console.log(`  - ${problem}`)
}
console.log(`\n${report.length} captures, ${failing.length} with layout problems. Output: ${outDir}`)
process.exitCode = failing.length > 0 ? 1 : 0
