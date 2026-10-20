import { describe, expect, it } from 'vitest'
import {
  cloneBudgetMonth,
  createEmptyBudgetMonth,
  createInitialAppData,
} from './factory'
import { parseAppData } from './schema'

describe('budget factories', () => {
  it('creates schema-valid initial data', () => {
    const data = createInitialAppData(new Date(2026, 8, 1))
    expect(parseAppData(data)).toEqual(data)
    expect(data.budgetMonths[0]!.name).toBe('Septembre 2026')
  })

  it('migrates version 1 backups without imported transactions', () => {
    const current = createInitialAppData(new Date(2026, 8, 1))
    const legacy = {
      ...current,
      schemaVersion: 1,
      importedTransactions: undefined,
    }

    const migrated = parseAppData(legacy)

    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.importedTransactions).toEqual([])
  })

  it('clones content with fresh entity identifiers', () => {
    const source = createEmptyBudgetMonth(2026, 9)
    const clone = cloneBudgetMonth(source, 2026, 10)

    expect(clone.id).not.toBe(source.id)
    expect(clone.incomes[0]!.id).not.toBe(source.incomes[0]!.id)
    expect(clone.accounts[0]!.id).not.toBe(source.accounts[0]!.id)
    expect(clone.expenseCategories[0]!.accountId).toBe(clone.accounts[0]!.id)
    expect(clone.name).toBe('Octobre 2026')
  })

  it('rejects backups with broken account references', () => {
    const data = createInitialAppData(new Date(2026, 8, 1))
    data.budgetMonths[0]!.expenseCategories[0]!.accountId =
      crypto.randomUUID()

    expect(() => parseAppData(data)).toThrow(
      'Le compte affecté à cette catégorie est introuvable.',
    )
  })

  it('rejects backups without a valid active month', () => {
    const data = createInitialAppData(new Date(2026, 8, 1))
    data.settings.activeBudgetMonthId = crypto.randomUUID()

    expect(() => parseAppData(data)).toThrow(
      'Le budget actif ne correspond à aucun mois.',
    )
  })
})
