import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useAuth } from './auth-context'
import { BudgetProvider } from './BudgetContext'
import { SyncContext } from './sync-context'
import { CloudBudgetRepository } from '../data/cloud/CloudBudgetRepository'
import { SupabaseTransport } from '../data/cloud/SupabaseTransport'
import { BudgetDatabase } from '../data/indexeddb/database'
import type { SyncState } from '../data/cloud/types'
import { useAccountTabLock } from './useAccountTabLock'

const guestState = { status: 'disabled' as const }
const subscribeGuest = () => () => {}
const getGuestSnapshot = () => guestState

function ScopedBudget({ children, userId }: { children: ReactNode; userId: string | null }) {
  const { client } = useAuth()
  const tabStatus = useAccountTabLock(userId)
  const repository = useMemo(() => client && userId
    ? new CloudBudgetRepository(new BudgetDatabase(`finance-user-${userId}`), new SupabaseTransport(client, userId))
    : null, [client, userId])
  const state = useSyncExternalStore<SyncState>(repository?.subscribe ?? subscribeGuest,
    repository?.getSnapshot ?? getGuestSnapshot)

  useEffect(() => {
    if (!repository || tabStatus !== 'active') return
    const sync = () => { void repository.sync() }
    const visible = () => { if (document.visibilityState === 'visible') sync() }
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', visible)
    const timer = window.setInterval(sync, 30_000)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', visible)
      window.clearInterval(timer)
    }
  }, [repository, tabStatus])

  if (tabStatus !== 'active') return <main className="content-page narrow-page">
    <h1>{tabStatus === 'checking' ? 'Opening your budgets…' : 'Account already open in another tab'}</h1>
    {tabStatus === 'blocked' && <><p>To protect pending edits, use one Finance tab per account on this browser. Close the other tab, then reload this one.</p>
      <button className="primary-button" onClick={() => window.location.reload()}>Reload this tab</button></>}
  </main>

  return <SyncContext.Provider value={{ repository, state }}>
    <BudgetProvider repository={repository ?? undefined} migrateLegacy={!userId}>
      {children}
    </BudgetProvider>
  </SyncContext.Provider>
}

export function BudgetScope({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <main className="loading-screen"><p>Opening your account…</p></main>
  const userId = session?.user.id ?? null
  return <ScopedBudget key={userId ?? 'guest'} userId={userId}>{children}</ScopedBudget>
}
