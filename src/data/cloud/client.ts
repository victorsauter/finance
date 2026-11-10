import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type FinanceCloudClient = SupabaseClient<Database>

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Missing configuration deliberately leaves the existing guest app available.
export const supabase = import.meta.env.MODE !== 'test' && url && key ? createClient<Database>(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null
