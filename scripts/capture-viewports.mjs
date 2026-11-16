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
