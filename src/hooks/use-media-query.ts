import { useCallback, useSyncExternalStore } from 'react'

/**
 * Tracks a CSS media query. `fallback` is returned when `matchMedia` is not
 * available (jsdom, very old browsers) and on the server.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = useCallback(
    () => window.matchMedia?.(query).matches ?? fallback,
    [query, fallback],
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback)
}
