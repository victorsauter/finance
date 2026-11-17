/** Search params shared by the routes that show one budget month. */
export interface MonthSearch {
  /** Month as `YYYY-MM`. Absent means "the current month". */
  m?: string
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * TanStack Router `validateSearch` for `?m=YYYY-MM`. Anything that is not a
 * valid month key is dropped instead of throwing, so a hand-edited URL never
 * breaks the page.
 */
export function validateMonthSearch(
  search: Record<string, unknown>,
): MonthSearch {
  const { m } = search
  return typeof m === 'string' && MONTH_PATTERN.test(m) ? { m } : {}
}
