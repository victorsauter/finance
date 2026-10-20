import { Laptop, Moon, Sun } from 'lucide-react'
import type { ThemePreference } from '../../app/theme'
import { useTheme } from '../../app/theme-context'

const themeOptions = [
  { value: 'system', label: 'System', Icon: Laptop },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] satisfies Array<{
  value: ThemePreference
  label: string
  Icon: typeof Laptop
}>

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme()

  return (
    <div className={`theme-control ${compact ? 'is-compact' : ''}`}>
      <span className="theme-control-label">Appearance</span>
      <div className="theme-segmented" role="group" aria-label="Appearance">
        {themeOptions.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            className={preference === value ? 'is-active' : ''}
            aria-label={`${label} theme`}
            aria-pressed={preference === value}
            title={label}
            onClick={() => setPreference(value)}
          >
            <Icon aria-hidden="true" size={16} strokeWidth={2.1} />
            <span className="visually-hidden">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
