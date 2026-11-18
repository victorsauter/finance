import { expect, test, type Page } from '@playwright/test'
import {
  inspectLayout,
  layoutPages,
  layoutWidths,
  readFrame,
  seedRichBudget,
} from './layout-support'
import { fakeCloud, signIn } from './support'

// Layout regression guard: at every width, in light and dark, no page may
// overflow horizontally, overlap its own cards, push content out of a card or
// sit under the fixed chrome, and the four routes must share one frame (same
// container, same title x). The same checks power scripts/capture-viewports.mjs,
// which also saves screenshots for review.

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
}

async function checkRoutes(page: Page, width: number, theme: string) {
  const frames: Record<string, Awaited<ReturnType<typeof readFrame>>> = {}
  for (const [name, path] of layoutPages) {
    await page.goto(path)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await settle(page)
    const problems = await page.evaluate(inspectLayout)
    expect(problems, `${name} at ${width}px (${theme})`).toEqual([])
    frames[name] = await page.evaluate(readFrame)
    expect(frames[name].h1Count, `${name}: one h1`).toBe(1)
    expect(frames[name].mainCount, `${name}: one main`).toBe(1)
  }
  const reference = frames.budget
  for (const [name, frame] of Object.entries(frames)) {
    expect(
      { mainLeft: frame.mainLeft, mainRight: frame.mainRight },
      `${name} container matches budget at ${width}px (${theme})`,
    ).toEqual({ mainLeft: reference.mainLeft, mainRight: reference.mainRight })
    expect(
      { titleLeft: frame.titleLeft, headerLeft: frame.headerLeft },
      `${name} title left edge matches budget at ${width}px (${theme})`,
    ).toEqual({
      titleLeft: reference.titleLeft,
      headerLeft: reference.headerLeft,
    })
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`layout matrix, ${colorScheme}`, () => {
    test.skip(
      ({ isMobile }) => isMobile,
      'Widths are set by the test; the desktop project is enough.',
    )
    test.use({ colorScheme })

    for (const width of layoutWidths) {
      test(`has no overflow or overlap at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto('/?m=2030-08')
        await page.getByRole('heading', { level: 1 }).waitFor()
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          colorScheme,
        )
        await checkRoutes(page, width, colorScheme)

        // A busy budget exercises the editor rows and the Sankey with more
        // than one income and long names.
        await page.goto('/?m=2030-08')
        await page.getByRole('heading', { name: 'Build your month' }).waitFor()
        await seedRichBudget(page)
        await settle(page)
        expect(
          await page.evaluate(inspectLayout),
          `busy budget at ${width}px (${colorScheme})`,
        ).toEqual([])
      })
    }
  })
}

test.describe('layout, signed in', () => {
  test.skip(({ isMobile }) => isMobile, 'Widths are set by the test.')

  // The sync notice and the account cards add chrome the guest state lacks.
  for (const width of [360, 768, 1440]) {
    test(`has no overflow or overlap at ${width}px`, async ({ page }) => {
      await fakeCloud(page)
      await page.setViewportSize({ width, height: 900 })
      await signIn(page)
      await settle(page)
      expect(await page.evaluate(inspectLayout), `account at ${width}px`).toEqual(
        [],
      )
      await page.goto('/?m=2030-08')
      await page.getByRole('heading', { level: 1 }).waitFor()
      await expect(page.getByRole('status').first()).toContainText(
        'Cloud sync needs your confirmation.',
      )
      await settle(page)
      expect(await page.evaluate(inspectLayout), `budget at ${width}px`).toEqual(
        [],
      )
    })
  }
})
