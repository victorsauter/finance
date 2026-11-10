import type { FinanceCloudClient } from './client'
import type { Json } from './database.types'
import { parseAppData } from '../../domain/budget/schema'
import type { AppData } from '../../domain/budget/models'
import type { CloudTransport, CloudSnapshot, CloudWrite } from './types'

export class SupabaseTransport implements CloudTransport {
  private client: FinanceCloudClient
  private userId: string

  constructor(client: FinanceCloudClient, userId: string) {
    this.client = client
    this.userId = userId
  }

  private async checkIdentity() {
    const { data, error } = await this.client.auth.getSession()
    if (error) throw error
    if (data.session?.user.id !== this.userId) throw new Error('Please sign in again before syncing.')
    return data.session.access_token
  }

  async read(): Promise<CloudSnapshot | null> {
    const token = await this.checkIdentity()
    const { data, error } = await this.client.from('finance_documents')
      .select('data,revision').eq('user_id', this.userId).maybeSingle()
      .setHeader('Authorization', `Bearer ${token}`)
    if (error) throw error
    if (data && (!Number.isSafeInteger(data.revision) || data.revision < 1)) throw new Error('Unexpected cloud revision.')
    return data ? { data: parseAppData(data.data), revision: data.revision } : null
  }

  async write(data: AppData, revision: number, mutationId: string): Promise<CloudWrite> {
    const token = await this.checkIdentity()
    const { data: result, error } = await this.client.rpc('save_finance_document', {
      document: parseAppData(data) as unknown as Json, expected_revision: revision, mutation_id: mutationId,
    }).setHeader('Authorization', `Bearer ${token}`)
    if (error) throw error
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || (result.status !== 'saved' && result.status !== 'conflict') || !Number.isSafeInteger(result.revision)) {
      throw new Error('Unexpected cloud save response.')
    }
    return result as CloudWrite
  }
}
