import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getMonthName, monthKey } from '@/domain/budget/factory'
import { cn } from '@/lib/utils'

// Fixed English labels: Intl's en-GB short form is "Sept" for September.
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

export interface MonthCalendarProps {
  /** Year whose 12 months are displayed. */
  year: number
  onYearChange: (year: number) => void
  /** `YYYY-MM` of the month being viewed. */
  selectedKey: string
  /** `YYYY-MM` of today's calendar month, highlighted. */
  currentKey: string
  /** `YYYY-MM` keys of the months that hold saved data. */
  savedKeys: readonly string[]
  onSelect: (year: number, month: number) => void
}

/**
 * Year stepper plus a 12-month grid. Any month of any year can be picked,
 * with or without data. Pure and controlled: the caller owns the displayed
 * year and what a selection does.
 */
export function MonthCalendar({
  year,
  onYearChange,
  selectedKey,
  currentKey,
  savedKeys,
  onSelect,
}: MonthCalendarProps) {
  const saved = new Set(savedKeys)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          className="size-11"
          aria-label="Previous year"
          onClick={() => onYearChange(year - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p
          className="font-heading text-base font-semibold tabular-nums"
          aria-live="polite"
          data-testid="calendar-year"
        >
          {year}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="size-11"
          aria-label="Next year"
          onClick={() => onYearChange(year + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <div
        className="grid grid-cols-4 gap-1"
        role="group"
        aria-label={`Months of ${year}`}
      >
        {MONTH_LABELS.map((label, index) => {
          const month = index + 1
          const key = monthKey(year, month)
          const isSelected = key === selectedKey
          const isCurrent = key === currentKey
          const isSaved = saved.has(key)
          return (
            <Button
              key={key}
              type="button"
              variant={isSelected ? 'default' : 'ghost'}
              className={cn(
                'relative h-11',
                isCurrent && !isSelected && 'border-primary text-primary',
              )}
              aria-label={getMonthName(year, month)}
              aria-description={isSaved ? 'Has saved data' : undefined}
              aria-pressed={isSelected}
              aria-current={isCurrent ? 'date' : undefined}
              data-saved={isSaved ? 'true' : undefined}
              onClick={() => onSelect(year, month)}
            >
              {label}
              {isSaved && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute bottom-1 size-1 rounded-full',
                    isSelected ? 'bg-primary-foreground' : 'bg-success',
                  )}
                />
              )}
            </Button>
          )
        })}
      </div>

      <p className="flex items-center gap-4 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-success"
          />
          Saved
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm border border-primary"
          />
          This month
        </span>
      </p>
    </div>
  )
}
