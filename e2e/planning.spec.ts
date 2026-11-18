import { expect, test, type Locator, type Page } from '@playwright/test'
import { commit, expectSaved } from './support'

// The planning editor: add, reorder (mouse, keyboard, menu), delete with undo,
// delete with confirmation. Each test works on its own far-away month so the
// default month stays untouched.
const month = '/?m=2030-05'

const incomeNames = (page: Page) => page.getByRole('textbox', { name: /^Income name/ })
const accountNames = (page: Page) => page.getByRole('textbox', { name: /^Account name/ })

async function values(inputs: Locator) {
  return inputs.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).value),
  )
}

/** A second income so that reordering is possible. */
async function addSecondIncome(page: Page) {
  await page.getByRole('button', { name: 'Add income' }).click()
  const name = incomeNames(page).nth(1)
  await expect(name).toBeFocused()
  await commit(name, 'Side income')
  await commit(page.getByLabel('Amount for Side income'), '800')
  await expect(incomeNames(page)).toHaveCount(2)
}

/** Moves a row with the mouse: grab its handle and drop it on another row. */
async function dragHandle(page: Page, from: string, onto: Locator, where: 'above' | 'below') {
  const handle = page.getByRole('button', { name: `Reorder ${from}` })
  const source = await handle.boundingBox()
  const target = await onto.boundingBox()
  if (!source || !target) throw new Error('Cannot measure the drag handles')
  const startX = source.x + source.width / 2
  const startY = source.y + source.height / 2
  const endY =
    where === 'above' ? target.y - 4 : target.y + target.height + 4
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY + (endY > startY ? 8 : -8), { steps: 4 })
  await page.mouse.move(startX, endY, { steps: 12 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.goto(month)
  await expect(page.getByRole('heading', { name: 'Build your month' })).toBeVisible()
})

test('adds rows to every list and keeps them after reload', async ({ page }) => {
  await addSecondIncome(page)

  await page.getByRole('button', { name: 'Add account' }).click()
  await commit(accountNames(page).nth(1), 'Savings')
  await commit(page.getByLabel('Transfer to Savings'), '250')

  await page.getByRole('button', { name: 'Add category' }).click()
  const category = page.getByRole('textbox', { name: 'Category name 2' })
  await expect(category).toBeFocused()
  await commit(category, 'Leisure')
  await page.getByLabel('Account for Leisure').selectOption({ label: 'Savings' })
  await page.getByRole('button', { name: 'Add expense' }).nth(1).click()
  await expect(page.getByRole('textbox', { name: /^Expense name 2 in Leisure/ })).toBeVisible()

  await expectSaved(page)
  await page.reload()
  await expect(incomeNames(page)).toHaveCount(2)
  await expect(page.getByLabel('Amount for Side income')).toHaveValue('800.00')
  await expect(page.getByLabel('Transfer to Savings')).toHaveValue('250.00')
  await expect(page.getByLabel('Account for Leisure')).toHaveValue(/.+/)
  await expect(page.getByRole('textbox', { name: /^Expense name \d in Leisure/ })).toHaveCount(2)
})

test('reorders a list by dragging with the mouse', async ({ page }) => {
  await addSecondIncome(page)
  await expect.poll(() => values(incomeNames(page))).toEqual(['Main income', 'Side income'])

  await dragHandle(page, 'Side income', incomeNames(page).first(), 'above')
  await expect.poll(() => values(incomeNames(page))).toEqual(['Side income', 'Main income'])

  await expectSaved(page)
  await page.reload()
  await expect.poll(() => values(incomeNames(page))).toEqual(['Side income', 'Main income'])
})

test('reorders a list with the keyboard', async ({ page }) => {
  await addSecondIncome(page)

  // dnd-kit announces every step in a live region; waiting for each message is
  // what a screen reader user hears, and keeps the key presses in order.
  const announcement = (text: string) => page.getByText(text, { exact: true })
  const handle = page.getByRole('button', { name: 'Reorder Side income' })
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(150) // dnd-kit attaches its key listener a tick later
  await page.keyboard.press('ArrowUp')
  await expect(announcement('Side income is over position 1 of 2.')).toBeAttached()
  await page.keyboard.press('Space')
  await expect(announcement('Side income dropped at position 1 of 2.')).toBeAttached()
  await expect.poll(() => values(incomeNames(page))).toEqual(['Side income', 'Main income'])

  // Escape cancels a pick-up without changing anything.
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(150) // dnd-kit attaches its key listener a tick later
  await page.keyboard.press('ArrowDown')
  await expect(announcement('Side income is over position 2 of 2.')).toBeAttached()
  await page.keyboard.press('Escape')
  await expect(announcement('Reordering cancelled. Side income did not move.')).toBeAttached()
  await expect.poll(() => values(incomeNames(page))).toEqual(['Side income', 'Main income'])
})

test('reorders through the row menu', async ({ page }) => {
  await addSecondIncome(page)

  await page.getByRole('button', { name: 'Actions for Main income' }).click()
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Move down' }).click()
  await expect.poll(() => values(incomeNames(page))).toEqual(['Side income', 'Main income'])

  await page.getByRole('button', { name: 'Actions for Main income' }).click()
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Move up' }).click()
  await expect.poll(() => values(incomeNames(page))).toEqual(['Main income', 'Side income'])
})

test('reorders expense categories', async ({ page }) => {
  await page.getByRole('button', { name: 'Add category' }).click()
  await commit(page.getByRole('textbox', { name: 'Category name 2' }), 'Leisure')
  const names = page.getByRole('textbox', { name: /^Category name/ })
  await expect.poll(() => values(names)).toEqual(['Housing', 'Leisure'])

  await page.getByRole('button', { name: 'Actions for Leisure' }).click()
  await page.getByRole('menuitem', { name: 'Move up' }).click()
  await expect.poll(() => values(names)).toEqual(['Leisure', 'Housing'])
})

test('deletes an income at once and brings it back with Undo', async ({ page }) => {
  await addSecondIncome(page)

  await page.getByRole('button', { name: 'Actions for Main income' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  // No confirmation for a single row: it is gone, with an Undo toast.
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(incomeNames(page)).toHaveCount(1)
  await expect.poll(() => values(incomeNames(page))).toEqual(['Side income'])
  const toast = page.getByRole('listitem').filter({ hasText: 'Income deleted' })
  await expect(toast).toBeVisible()

  await toast.getByRole('button', { name: 'Undo' }).click()
  // Back where it was, first in the list.
  await expect.poll(() => values(incomeNames(page))).toEqual(['Main income', 'Side income'])
  await expectSaved(page)
})

test('asks before deleting an account and keeps it when cancelled', async ({ page }) => {
  await page.getByRole('button', { name: 'Add account' }).click()
  await commit(accountNames(page).nth(1), 'Savings')
  await expect(accountNames(page)).toHaveCount(2)

  await page.getByRole('button', { name: 'Actions for Savings' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Delete Savings?')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(accountNames(page)).toHaveCount(2)

  await page.getByRole('button', { name: 'Actions for Savings' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete account' }).click()
  await expect(accountNames(page)).toHaveCount(1)
  await expect.poll(() => values(accountNames(page))).toEqual(['Main account'])
})

test('asks before deleting a category with its expenses', async ({ page }) => {
  await page.getByRole('button', { name: 'Actions for Housing' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete category' }).click()
  await expect(page.getByRole('textbox', { name: /^Category name/ })).toHaveCount(0)
})
