import type { ComponentProps } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NativeSelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  /** Classes for the wrapper (width, grid placement). */
  wrapperClassName?: string
}

/**
 * Styled native `<select>`. Prefer it over the Base UI `Select` for dense
 * forms and mobile: the OS picker is used, the control is a real form element
 * (testable with `selectOption`) and it is 44px tall by default (`h-11`).
 * Pass a responsive class such as `@3xl:h-9` to compact it on wide layouts.
 */
export function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn('relative w-full min-w-0', wrapperClassName)}
    >
      <select
        data-slot="native-select"
        className={cn(
          'h-11 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-transparent py-2 pr-8 pl-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}
