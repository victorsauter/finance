import { useLayoutEffect, useRef } from 'react'
import { useBudget } from '@/app/budget-context'
import { monthKey } from '@/domain/budget/factory'

/**
 * Keeps the active month and the `m` search param (`YYYY-MM`) in step.
 *
 * - `m` present: opens that month (virtual and unsaved when it has no data).
 *   Runs before paint, so a reload on `/?m=2026-08` never flashes the
 *   previously active month.
 * - `m` absent: the persisted active month stays shown and its key is written
 *   to the URL (history entry replaced), so the address always names the month.
 *
 * `writeMonth` is only called for that second case; picking a month in the UI
 * writes `m` itself and this hook then opens it.
 */
export function useMonthParam(
  m: string | undefined,
  writeMonth: (key: string) => void,
) {
  const { activeBudget, openMonth } = useBudget()
  const activeKey = monthKey(activeBudget.year, activeBudget.month)
  const writeRef = useRef(writeMonth)

  useLayoutEffect(() => {
    writeRef.current = writeMonth
  })

  useLayoutEffect(() => {
    if (!m) {
      writeRef.current(activeKey)
      return
    }
    if (m === activeKey) return
    const [year, month] = m.split('-').map(Number)
    if (year !== undefined && month !== undefined) openMonth(year, month)
  }, [m, activeKey, openMonth])
}
