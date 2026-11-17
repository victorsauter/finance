import { useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  RotateCcw,
} from 'lucide-react'
import { useBudget } from '@/app/budget-context'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  getMonthName,
  monthKey,
  nextMonth,
  previousMonth,
} from '@/domain/budget/factory'
import { MonthCalendar } from './MonthCalendar'

interface MonthToolbarProps {
  /** Called when the user picks a month; the route writes it to `?m=`. */
  onSelectMonth: (year: number, month: number) => void
}

/**
 * Month controls: calendar-month chevrons, a popover with the year calendar
 * and the month actions menu. It only reads the active month; changing it is
 * the route's job (the month lives in the URL).
 */
export function MonthToolbar({ onSelectMonth }: MonthToolbarProps) {
  const confirm = useConfirm()
  const {
    activeBudget,
    activeBudgetIsVirtual,
    savedMonthKeys,
    resetActiveBudget,
  } = useBudget()
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(activeBudget.year)
  const [currentKey] = useState(() => {
    const today = new Date()
    return monthKey(today.getFullYear(), today.getMonth() + 1)
  })

  const { year, month } = activeBudget
  const selectedKey = monthKey(year, month)

  const step = (target: { year: number; month: number }) =>
    onSelectMonth(target.year, target.month)

  const handleOpenChange = (next: boolean) => {
    // Always start on the year of the month being viewed.
    if (next) setViewYear(year)
    setOpen(next)
  }

  const handleReset = async () => {
    const confirmed = await confirm({
      title: `Reset ${activeBudget.name}?`,
      message:
        'This month goes back to the plan of the nearest earlier month, or to an empty plan. Imported transactions keep their place but lose categories that no longer exist.',
      confirmLabel: 'Reset month',
      tone: 'danger',
    })
    if (confirmed) resetActiveBudget()
  }

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <Button
        type="button"
        variant="outline"
        className="size-11"
        aria-label="Previous month"
        onClick={() => step(previousMonth(year, month))}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-0 flex-1 gap-2 px-3 sm:w-48 sm:flex-none"
            />
          }
        >
          <CalendarDays aria-hidden="true" className="text-muted-foreground" />
          <span className="flex-1 truncate text-left">
            {getMonthName(year, month)}
          </span>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-72">
          <MonthCalendar
            year={viewYear}
            onYearChange={setViewYear}
            selectedKey={selectedKey}
            currentKey={currentKey}
            savedKeys={savedMonthKeys}
            onSelect={(nextYear, nextMonthNumber) => {
              setOpen(false)
              onSelectMonth(nextYear, nextMonthNumber)
            }}
          />
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="outline"
        className="size-11"
        aria-label="Next month"
        onClick={() => step(nextMonth(year, month))}
      >
        <ChevronRight aria-hidden="true" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="size-11"
              aria-label="Budget actions"
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11"
            disabled={activeBudgetIsVirtual}
            onClick={() => void handleReset()}
          >
            <RotateCcw aria-hidden="true" />
            Reset month
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
