/** Search params shared by the routes that show one budget month. */
export interface MonthSearch {
  /** Month as `YYYY-MM`. Absent means "the current month". */
  m?: string
}

import { MAX_BUDGET_YEAR, MIN_BUDGET_YEAR } from '@/domain/budget/models'

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

/**
 * TanStack Router `validateSearch` for `?m=YYYY-MM`. Anything that is not a
 * valid month key is dropped instead of throwing, so a hand-edited URL never
 * breaks the page.
 */
export function validateMonthSearch(
  search: Record<string, unknown>,
): MonthSearch {
  const { m } = search
  if (typeof m !== 'string') return {}
  const match = MONTH_PATTERN.exec(m)
  if (!match) return {}
  const year = Number(match[1])
  return year >= MIN_BUDGET_YEAR && year <= MAX_BUDGET_YEAR ? { m } : {}
}
