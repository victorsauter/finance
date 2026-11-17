import { expect, test } from '@playwright/test'
import { inspectLayout, seedRichBudget } from './layout-support'

// Layout regression guard: at every width, no page may overflow horizontally,
// overlap its own cards, or push content out of a card. The same checks power
// scripts/capture-viewports.mjs, which also saves screenshots for review.
const widths = [360, 390, 768, 1024, 1180, 1240, 1440, 1920]
const pages = [
  ['budget', '/'],
  ['transactions', '/transactions'],
  ['backup', '/backup'],
  ['account', '/account'],
] as const

test.describe('layout matrix', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'Widths are set by the test; the desktop project is enough.',
  )

  for (const width of widths) {
    test(`has no overflow or overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await page.getByLabel('Amount for Main income').fill('3500')
      await page.getByLabel('Amount for Main income').press('Tab')

      for (const [name, path] of pages) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        const problems = await page.evaluate(inspectLayout)
        expect(problems, `${name} at ${width}px`).toEqual([])
      }

      await page.goto('/')
      await page.getByRole('heading', { name: 'Build your month' }).waitFor()
      await seedRichBudget(page)
      const richProblems = await page.evaluate(inspectLayout)
      expect(richProblems, `busy budget at ${width}px`).toEqual([])
    })
  }
})
