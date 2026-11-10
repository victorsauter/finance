import { describe, expect, it, vi } from 'vitest'
import { SupabaseTransport } from './SupabaseTransport'
import type { FinanceCloudClient } from './client'
import { createInitialAppData } from '../../domain/budget/factory'

function client(userId = 'owner', response: unknown = { status: 'saved', revision: 1 }) {
  const setHeader = vi.fn().mockResolvedValue({ data: response, error: null })
  const rpc = vi.fn().mockReturnValue({ setHeader })
  const getSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: userId }, access_token: 'owner-token' } }, error: null })
  const value = { auth: { getSession }, rpc } as unknown as FinanceCloudClient
  return { value, rpc, setHeader }
}

describe('Supabase transport identity and contract', () => {
  it('pins the checked account token to the mutation request', async () => {
    const fake = client()
    const transport = new SupabaseTransport(fake.value, 'owner')
    const data = createInitialAppData()
    await expect(transport.write(data, 0, 'mutation')).resolves.toEqual({ status: 'saved', revision: 1 })
    expect(fake.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer owner-token')
    expect(fake.rpc).toHaveBeenCalledWith('save_finance_document', { document: data, expected_revision: 0, mutation_id: 'mutation' })
  })

  it('never sends an old account snapshot using a different account session', async () => {
    const fake = client('different-account')
    const transport = new SupabaseTransport(fake.value, 'owner')
    await expect(transport.write(createInitialAppData(), 0, 'mutation')).rejects.toThrow('sign in again')
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed RPC responses instead of acknowledging the outbox', async () => {
    const fake = client('owner', { status: 'saved', revision: '1' })
    await expect(new SupabaseTransport(fake.value, 'owner').write(createInitialAppData(), 0, 'mutation'))
      .rejects.toThrow('Unexpected cloud save response')
  })
})
