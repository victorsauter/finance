// Captures every page at a matrix of widths and themes, and reports layout
// problems that overflow-x clipping would otherwise hide. The checks live in
// e2e/layout-support.ts and also run in CI as e2e/layout.spec.ts.
//
// Usage: node scripts/capture-viewports.mjs [baseUrl] [outDir] [widths]
//   baseUrl defaults to http://127.0.0.1:5173 (npm run dev; the repo's
//           .claude/launch.json uses 5301)
//   outDir  defaults to ./captures (git-ignored)
//   widths  comma separated, defaults to the whole layout matrix
//           (e.g. 360,768,1440)
//
// Files: <page>-<width>-<theme>.png (full page), budget-rich-*.png (busy
// month), budget-calendar-*.png (month calendar open) and, below 761px,
// <page>-<width>-<theme>-bottom.png (last screen, behind the dock).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import {
  inspectLayout,
  layoutPages,
  layoutWidths,
  readFrame,
  seedRichBudget,
} from '../e2e/layout-support.ts'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173'
const outDir = process.argv[3] ?? 'captures'
const widths = process.argv[4]
  ? process.argv[4].split(',').map(Number)
  : layoutWidths
const themes = ['light', 'dark']

/**
 * Whole-page screenshot taken at a viewport as tall as the page. Playwright's
 * fullPage mode flaps the media queries while it resizes (the sidebar briefly
 * collapses) and leaves fixed chrome mid-page; a real tall viewport shows the
 * page as a person with a very tall screen would see it.
 */
async function shootWholePage(page, file, height) {
  const size = page.viewportSize()
  let target = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let i = 0; i < 2; i++) {
    await page.setViewportSize({ width: size.width, height: Math.min(target, 8000) })
    await page.waitForTimeout(350)
    target = await page.evaluate(() => document.documentElement.scrollHeight)
  }
  await page.screenshot({ path: file })
  await page.setViewportSize({ width: size.width, height })
  await page.waitForTimeout(250)
}

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const report = []

for (const theme of themes) {
  for (const width of widths) {
    const mobile = width < 761
    const viewportHeight = mobile ? 844 : 900
    const context = await browser.newContext({
      viewport: { width, height: viewportHeight },
      deviceScaleFactor: 1,
      isMobile: width < 700,
      hasTouch: width < 700,
      colorScheme: theme,
      serviceWorkers: 'block',
    })
    const page = await context.newPage()
    page.on('pageerror', (error) =>
      console.log(`page error @ ${width}px (${theme}): ${error.message}`),
    )
    const frames = {}

    for (const [name, path] of layoutPages) {
      await page.goto(baseUrl + path)
      await page.getByRole('heading', { level: 1 }).waitFor()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400)
      const problems = await page.evaluate(inspectLayout)
      frames[name] = await page.evaluate(readFrame)
      await shootWholePage(page, join(outDir, `${name}-${width}-${theme}.png`), viewportHeight)
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(150)
        await page.screenshot({ path: join(outDir, `${name}-${width}-${theme}-bottom.png`) })
        await page.evaluate(() => window.scrollTo(0, 0))
      }
      report.push({ page: name, width, theme, problems })
    }

    // The four routes must share one frame: same container, same title x.
    const reference = frames.budget
    const frameProblems = []
    for (const [name, frame] of Object.entries(frames)) {
      for (const key of ['mainLeft', 'mainRight', 'titleLeft', 'headerLeft']) {
        if (frame[key] !== reference[key]) {
          frameProblems.push(`${name} ${key} ${frame[key]} differs from budget ${reference[key]}`)
        }
      }
    }
    report.push({ page: 'frame', width, theme, problems: frameProblems })

    // Busy month: long names, several accounts and categories, so the Sankey
    // and the editor are checked with realistic content, not just one income.
    await page.goto(baseUrl + '/?m=2030-08')
    await page.getByRole('heading', { name: 'Build your month' }).waitFor()
    await seedRichBudget(page)
    await page.waitForTimeout(500)
    const richProblems = await page.evaluate(inspectLayout)
    await shootWholePage(page, join(outDir, `budget-rich-${width}-${theme}.png`), viewportHeight)
    report.push({ page: 'budget-rich', width, theme, problems: richProblems })

    // The month calendar, open (a popover over the page header).
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('button', { name: 'August 2030', exact: true }).click()
    await page.getByRole('button', { name: 'Previous year' }).waitFor()
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(outDir, `budget-calendar-${width}-${theme}.png`) })

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
console.log(`\n${report.length} checks, ${failing.length} with layout problems. Output: ${outDir}`)
process.exitCode = failing.length > 0 ? 1 : 0
