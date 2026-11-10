import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type FinanceCloudClient } from '../data/cloud/client'
import { AuthContext } from './auth-context'

export function AuthProvider({ children, client = supabase }: {
  children: ReactNode
  client?: FinanceCloudClient | null
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(client))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!client) return
    let active = true
    let authEvent = false
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      authEvent = true
      if (active) { setSession(next); setLoading(false); setError(null) }
    })
    void client.auth.getSession().then(({ data, error: failure }) => {
      if (!active || authEvent) return
      if (failure) setError(failure.message)
      else setSession(data.session)
      setLoading(false)
    }).catch(() => {
      if (active) { setError('Unable to restore your session. Please sign in again.'); setLoading(false) }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [client])

  const signOut = async () => {
    if (!client) return
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw error
    setSession(null)
  }

  return <AuthContext.Provider value={{ client, session, loading, error, signOut }}>{children}</AuthContext.Provider>
}
