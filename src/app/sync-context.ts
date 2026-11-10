import { createContext, useContext } from 'react'
import type { CloudBudgetRepository } from '../data/cloud/CloudBudgetRepository'
import type { SyncState } from '../data/cloud/types'

export const SyncContext = createContext<{
  repository: CloudBudgetRepository | null
  state: SyncState
}>({ repository: null, state: { status: 'disabled' } })

export function useSync() { return useContext(SyncContext) }
