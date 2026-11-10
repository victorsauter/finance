import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { FinanceCloudClient } from '../data/cloud/client'

export interface AuthState {
  client: FinanceCloudClient | null
  session: Session | null
  loading: boolean
  error: string | null
  signOut(): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider.')
  return value
}
