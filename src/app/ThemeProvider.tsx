import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DARK_MODE_QUERY,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from './theme'
import { ThemeContext, type ThemeContextValue } from './theme-context'

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch (error) {
    console.warn('La préférence de thème locale est inaccessible.', error)
    return 'system'
  }
}

function systemPrefersDark() {
  return window.matchMedia?.(DARK_MODE_QUERY).matches ?? false
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readStoredPreference)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)
  const resolvedTheme = resolveTheme(preference, prefersDark)

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(DARK_MODE_QUERY)
    if (!mediaQuery) return

    const updateSystemTheme = (event: MediaQueryListEvent) =>
      setPrefersDark(event.matches)
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.dataset.themePreference = preference
    root.style.colorScheme = resolvedTheme
    document
      .querySelector<HTMLMetaElement>('#theme-color-app')
      ?.setAttribute(
        'content',
        resolvedTheme === 'dark' ? '#0c0f19' : '#f3f5fb',
      )
  }, [preference, resolvedTheme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference: (nextPreference) => {
        setPreferenceState(nextPreference)
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference)
        } catch (error) {
          console.error(
            'Impossible d’enregistrer la préférence de thème.',
            error,
          )
        }
      },
    }),
    [preference, resolvedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
