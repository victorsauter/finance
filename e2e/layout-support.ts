// Shared by e2e/layout.spec.ts and scripts/capture-viewports.mjs.
// Plain JavaScript syntax on purpose (this file is also run by Node directly):
// inspectLayout and readFrame are serialised into the page, so they must not
// use outside values.

/** Viewport widths of the layout matrix, including both sides of every breakpoint. */
export const layoutWidths = [
  360, 390, 480, 481, 760, 761, 768, 980, 981, 1024, 1180, 1181, 1240, 1440,
  1920,
]

/** The four routes. `/` is opened on a fixed month so runs are repeatable. */
export const layoutPages = [
  ['budget', '/?m=2030-08'],
  ['transactions', '/transactions?m=2030-08'],
  ['backup', '/backup'],
  ['account', '/account'],
]

/**
 * Runs in the page. Returns layout problems; an empty list means the layout is
 * clean. Overflow clipping would hide these problems, so it looks for them
 * explicitly:
 *  - horizontal page scroll, and elements past the right viewport edge;
 *  - sibling overlap inside any grid or flex container of the page;
 *  - content leaving the card that holds it;
 *  - text cut off by `overflow: hidden` without an ellipsis;
 *  - the fixed header, dock or sidebar covering interactive content;
 *  - overlapping or clipped Sankey labels.
 */
export function inspectLayout() {
  const problems = []
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight

  const label = (el) => {
    const slot = el.getAttribute('data-slot')
    const cls =
      el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : ''
    const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 24) || ''
    return `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ''}${cls} "${name}"`
  }
  const isClipping = (value) =>
    value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip'
  // True when an ancestor (below <body>) scrolls or clips this element
  // horizontally, which legitimately hides what lies beyond its box.
  const clipped = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p === document.body || p === document.documentElement) return false
      if (isClipping(getComputedStyle(p).overflowX)) return true
    }
    return false
  }
  const measurable = (el) => {
    if (!el.checkVisibility()) return null
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null // sr-only and empty boxes
    return r
  }
  const positioned = (el) => {
    const position = getComputedStyle(el).position
    return position === 'absolute' || position === 'fixed'
  }

  // 1. Page-level horizontal overflow.
  if (document.documentElement.scrollWidth > vw) {
    problems.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`)
  }
  const main = document.querySelector('main')
  if (!main) problems.push('no <main> landmark')
  const scope = [...document.querySelectorAll('main, header, aside, nav, footer')]
  for (const root of scope) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const r = measurable(el)
      if (!r || clipped(el) || el.closest('svg')) continue
      if (r.right > vw + 1) {
        problems.push(`${label(el)} extends past the right viewport edge (${Math.round(r.right)} > ${vw})`)
      }
    }
  }

  // 2. Siblings of any grid or flex container must not overlap each other.
  for (const parent of document.querySelectorAll('main *')) {
    const display = getComputedStyle(parent).display
    if (display !== 'grid' && display !== 'flex' && display !== 'inline-flex') continue
    if (!parent.checkVisibility() || parent.closest('svg')) continue
    const kids = [...parent.children].filter((k) => measurable(k) && !positioned(k))
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

  // 3. Content must stay inside the card that holds it.
  for (const card of document.querySelectorAll('main [data-slot="card"]')) {
    const cr = card.getBoundingClientRect()
    for (const el of card.querySelectorAll('*')) {
      if (el.closest('svg') || !measurable(el) || clipped(el) || positioned(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right > cr.right + 1 || r.left < cr.left - 1) {
        problems.push(`${label(el)} sticks out of ${label(card)} (${Math.round(Math.max(r.right - cr.right, cr.left - r.left))}px)`)
      }
    }
  }

  // 4. Text cut off without an ellipsis.
  const textBoxes = 'main h1, main h2, main h3, main p, main label, main button, main a, main [data-slot="badge"]'
  for (const el of document.querySelectorAll(textBoxes)) {
    if (!measurable(el)) continue
    const style = getComputedStyle(el)
    if (!isClipping(style.overflowX) || style.overflowX === 'auto' || style.overflowX === 'scroll') continue
    if (style.textOverflow === 'ellipsis') continue
    if (el.scrollWidth > el.clientWidth + 1) {
      problems.push(`${label(el)} clips its text (${el.scrollWidth} > ${el.clientWidth})`)
    }
  }

  // 5. Fixed chrome must never cover interactive content where it reserves
  // room: the mobile header at the top of the page, the dock at the bottom, the
  // sidebar everywhere. (Content scrolling under the header or dock mid-page is
  // normal; it is the first and last screens that have to be clear.)
  const overlays = [
    ...document.querySelectorAll('header.fixed, aside.fixed, nav.fixed'),
  ].filter((el) => el.checkVisibility() && getComputedStyle(el).position === 'fixed')
  const interactive = [
    ...document.querySelectorAll(
      'main a[href], main button, main input:not([type="hidden"]), main select, main textarea, main [role="button"]',
    ),
  ].filter((el) => measurable(el))
  const previousScroll = window.scrollY
  for (const target of ['top', 'bottom']) {
    window.scrollTo(0, target === 'top' ? 0 : document.documentElement.scrollHeight)
    for (const overlay of overlays) {
      const o = overlay.getBoundingClientRect()
      const isSidebar = overlay.tagName === 'ASIDE'
      const atTop = o.top + o.height / 2 < vh / 2
      if (!isSidebar && (target === 'top') !== atTop) continue
      for (const el of interactive) {
        const r = el.getBoundingClientRect()
        const ox = Math.min(r.right, o.right) - Math.max(r.left, o.left)
        const oy = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top)
        if (ox > 1 && oy > 1) {
          problems.push(`${overlay.tagName.toLowerCase()} covers ${label(el)} at scroll ${target}`)
        }
      }
    }
  }
  window.scrollTo(0, previousScroll)

  // 6. Sankey labels must not sit on top of each other or leave the chart.
  const chart = document.querySelector('main svg[role="img"]')
  const labels = chart
    ? [...chart.querySelectorAll('text')].map((t) => ({ el: t, r: t.getBoundingClientRect() }))
    : []
  const svgBox = chart?.getBoundingClientRect()
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i].r
    if (svgBox && a.right > svgBox.right + 1) {
      problems.push(`sankey label "${labels[i].el.textContent.slice(0, 24)}" leaves the chart (${Math.round(a.right - svgBox.right)}px)`)
    }
    for (let j = i + 1; j < labels.length; j++) {
      const b = labels[j].r
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ox > 1 && oy > 1) {
        problems.push(`sankey labels overlap ("${labels[i].el.textContent.slice(0, 24)}" / "${labels[j].el.textContent.slice(0, 24)}")`)
      }
    }
  }

  return [...new Set(problems)]
}

/**
 * Runs in the page. Geometry of the page frame, compared across the four
 * routes: the container and the title must start at the same x everywhere.
 */
export function readFrame() {
  const round = (value) => Math.round(value * 10) / 10
  const main = document.querySelector('main')
  const title = document.querySelector('main h1')
  const header = title?.closest('header')
  const m = main?.getBoundingClientRect()
  const t = title?.getBoundingClientRect()
  const h = header?.getBoundingClientRect()
  return {
    mainLeft: m ? round(m.left) : null,
    mainRight: m ? round(m.right) : null,
    titleLeft: t ? round(t.left) : null,
    headerLeft: h ? round(h.left) : null,
    headerRight: h ? round(h.right) : null,
    titleTop: t ? round(t.top + window.scrollY) : null,
    h1Count: document.querySelectorAll('h1').length,
    mainCount: document.querySelectorAll('main').length,
  }
}

/**
 * Fills the default month with a realistic, busy one: long names, several
 * incomes, accounts and categories and expenses, so the editor and the Sankey
 * are exercised with more than a single income.
 */
export async function seedRichBudget(page) {
  const commit = async (locator, value) => {
    await locator.fill(value)
    await locator.press('Tab')
  }
  const incomeName = page.getByRole('textbox', { name: /^Income name/ })
  const accountName = page.getByRole('textbox', { name: /^Account name/ })
  const transfers = page.getByRole('textbox', { name: /^Transfer to/ })

  await commit(incomeName.first(), 'Monthly salary from Example International Holdings')
  await commit(page.getByRole('textbox', { name: /^Amount for Monthly salary/ }), '4200')
  await page.getByRole('button', { name: 'Add income' }).click()
  await commit(incomeName.nth(1), 'Side projects')
  await commit(page.getByRole('textbox', { name: 'Amount for Side projects' }), '800')

  await page.getByRole('button', { name: 'Add account' }).click()
  await commit(accountName.nth(1), 'Joint account with a very long label')
  await page.getByRole('button', { name: 'Add account' }).click()
  await commit(accountName.nth(2), 'Savings')
  await commit(transfers.nth(0), '1800')
  await commit(transfers.nth(1), '1200')
  await commit(transfers.nth(2), '600')

  await page.getByRole('button', { name: 'Add category' }).click()
  await page.getByRole('button', { name: 'Add expense' }).first().click()
  await page.getByRole('button', { name: 'Add expense' }).first().click()
  await commit(
    page.getByRole('textbox', { name: /^Expense name 1 in Housing/ }),
    'Mortgage and home insurance payments',
  )

  const amounts = page.getByRole('textbox', { name: /^Amount for (?!Monthly|Side)/ })
  const count = await amounts.count()
  for (let i = 0; i < count; i++) await commit(amounts.nth(i), String(90 + i * 35))
}
