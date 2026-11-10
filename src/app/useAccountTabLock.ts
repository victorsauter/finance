import { useEffect, useState } from 'react'

// A whole-document local editor has one writer per account/browser. Different
// devices remain independent and use the server revision conflict mechanism.
export function useAccountTabLock(userId: string | null) {
  const [status, setStatus] = useState<'checking' | 'active' | 'blocked'>(
    () => !userId || !navigator.locks ? 'active' : 'checking',
  )
  useEffect(() => {
    if (!userId || !navigator.locks) return
    let cancelled = false
    let release: (() => void) | undefined
    void navigator.locks.request(`finance-account-editor-${userId}`, { ifAvailable: true }, async (lock) => {
      if (cancelled) return
      if (!lock) { setStatus('blocked'); return }
      setStatus('active')
      await new Promise<void>((resolve) => { release = resolve })
    }).catch(() => { if (!cancelled) setStatus('blocked') })
    return () => { cancelled = true; release?.() }
  }, [userId])
  return !userId ? 'active' : status
}
