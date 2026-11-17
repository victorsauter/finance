// Captures every page at a matrix of widths and themes, and reports layout
// problems that overflow-x clipping would otherwise hide. The checks live in
// e2e/layout-support.ts and also run in CI as e2e/layout.spec.ts.
//
// Usage: node scripts/capture-viewports.mjs [baseUrl] [outDir]
//   baseUrl defaults to http://127.0.0.1:5173 (npm run dev)
//   outDir  defaults to ./captures (git-ignored)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { inspectLayout, seedRichBudget } from '../e2e/layout-support.ts'

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
