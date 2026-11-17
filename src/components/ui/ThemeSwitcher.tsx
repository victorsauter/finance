import { Laptop, Moon, Sun } from 'lucide-react'
import type { ThemePreference } from '@/app/theme'
import { useTheme } from '@/app/theme-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const themeOptions = [
  { value: 'system', label: 'System', Icon: Laptop },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] satisfies Array<{
  value: ThemePreference
  label: string
  Icon: typeof Laptop
}>

interface ThemeSwitcherProps {
  /** Drops the "Appearance" caption and tightens the buttons. */
  compact?: boolean
  /** Stacks the three buttons (collapsed sidebar). */
  vertical?: boolean
}

export function ThemeSwitcher({
  compact = false,
  vertical = false,
}: ThemeSwitcherProps) {
  const { preference, setPreference } = useTheme()

  return (
    <div className="grid gap-1.5">
      {!compact && (
        <span className="px-1 text-xs font-semibold text-muted-foreground">
          Appearance
        </span>
      )}
      <div
        role="group"
        aria-label="Appearance"
        className={cn(
          'grid gap-0.5 rounded-xl border bg-muted/80 p-1',
          vertical ? 'grid-cols-1' : 'grid-cols-3',
        )}
      >
        {themeOptions.map(({ value, label, Icon }) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size={compact ? 'icon-sm' : 'icon'}
            className={cn(
              'w-full rounded-lg text-muted-foreground hover:bg-transparent hover:text-foreground',
              'aria-pressed:bg-card aria-pressed:text-accent-foreground aria-pressed:shadow-sm',
              'dark:hover:bg-transparent',
            )}
            aria-label={`${label} theme`}
            aria-pressed={preference === value}
            title={label}
            onClick={() => setPreference(value)}
          >
            <Icon aria-hidden="true" strokeWidth={2.1} />
            <span className="sr-only">{label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
