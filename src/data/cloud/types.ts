import type { AppData } from '../../domain/budget/models'

export interface CloudSnapshot {
  data: AppData
  revision: number
}

export type CloudWrite =
  | { status: 'saved'; revision: number }
  | { status: 'conflict'; revision: number }

export interface CloudTransport {
  read(): Promise<CloudSnapshot | null>
  write(data: AppData, revision: number, mutationId: string): Promise<CloudWrite>
}

export interface SyncMetadata {
  enabled: boolean
  revision: number
  sequence: number
  pending?: { id: string; data: AppData; sequence: number; revision: number }
  conflict?: CloudSnapshot
}

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'pending' | 'synced' | 'conflict' | 'error'

export interface SyncState {
  status: SyncStatus
  error?: string
}
