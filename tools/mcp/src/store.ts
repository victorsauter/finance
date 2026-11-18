import { SupabaseTransport } from '../../../src/data/cloud/SupabaseTransport.ts'
import type { FinanceCloudClient } from '../../../src/data/cloud/client.ts'
import type { CloudSnapshot, CloudWrite } from '../../../src/data/cloud/types.ts'
import type { AppData } from '../../../src/domain/budget/models.ts'

/**
 * The one cloud document. `write` is the `save_finance_document` RPC:
 * compare-and-swap on `revision`, idempotent on `mutationId`.
 */
export interface DocumentStore {
  read(): Promise<CloudSnapshot | null>
  write(data: AppData, revision: number, mutationId: string): Promise<CloudWrite>
}

/** The web app's own transport, over a Node client signed in as `userId`. */
export function createSupabaseStore(client: FinanceCloudClient, userId: string): DocumentStore {
  return new SupabaseTransport(client, userId)
}
