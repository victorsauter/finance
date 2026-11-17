import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '@/app/auth-context'
import { BudgetContext, type BudgetContextValue } from '@/app/budget-context'
import { SyncContext } from '@/app/sync-context'
import { Page } from '@/components/layout/Page'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import type { CloudBudgetRepository } from '@/data/cloud/CloudBudgetRepository'
import type { FinanceCloudClient } from '@/data/cloud/client'
import type { SyncState } from '@/data/cloud/types'
import { BudgetDatabase } from '@/data/indexeddb/database'
import { IndexedDbBudgetRepository } from '@/data/indexeddb/IndexedDbBudgetRepository'
import { createInitialAppData } from '@/domain/budget/factory'
import { AccountPage } from './AccountPage'

vi.mock('../backup/download', () => ({ downloadJson: vi.fn() }))

afterEach(cleanup)

interface Options {
  client?: FinanceCloudClient | null
  session?: Session | null
  sync?: SyncState
  repository?: Partial<CloudBudgetRepository>
}

function renderPage({
  client = null,
  session = null,
  sync = { status: 'disabled' },
  repository,
}: Options = {}) {
  const auth: AuthState = {
    client,
    session,
    loading: false,
    error: null,
    signOut: vi.fn().mockResolvedValue(undefined),
  }
  const budget = { data: createInitialAppData() } as unknown as BudgetContextValue
  const repo = repository
    ? ({
        inspectRemote: vi.fn().mockResolvedValue(null),
        ...repository,
      } as unknown as CloudBudgetRepository)
    : null
  render(
    <ConfirmProvider>
      <AuthContext.Provider value={auth}>
        <SyncContext.Provider value={{ repository: repo, state: sync }}>
          <BudgetContext.Provider value={budget}>
            <Page>
              <AccountPage />
            </Page>
          </BudgetContext.Provider>
        </SyncContext.Provider>
      </AuthContext.Provider>
    </ConfirmProvider>,
  )
  return auth
}

const session = { user: { email: 'pilot@example.invalid' } } as Session

describe('AccountPage', () => {
  it('explains local mode when cloud sync is not configured', () => {
    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Account and sync' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Local mode' })).toBeInTheDocument()
  })

  it('signs in with an email code', async () => {
    const user = userEvent.setup()
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    const verifyOtp = vi.fn().mockResolvedValue({ error: null })
    renderPage({
      client: { auth: { signInWithOtp, verifyOtp } } as unknown as FinanceCloudClient,
    })

    expect(screen.queryByLabelText('Email code')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Email address'), 'me@example.invalid')
    await user.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' }),
    )
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'me@example.invalid' }),
    )

    await user.type(await screen.findByLabelText('Email code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'me@example.invalid',
      token: '123456',
      type: 'email',
    })
  })

  it('shows a sign-in error as an alert linked to the form', async () => {
    const user = userEvent.setup()
    const signInWithOtp = vi
      .fn()
      .mockResolvedValue({ error: new Error('Email rate limit exceeded') })
    renderPage({
      client: { auth: { signInWithOtp } } as unknown as FinanceCloudClient,
    })

    await user.type(screen.getByLabelText('Email address'), 'me@example.invalid')
    await user.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email rate limit exceeded')
    expect(screen.getByLabelText('Email address')).toHaveAccessibleDescription(
      'Email rate limit exceeded',
    )
  })

  it('previews guest data before enabling sync on an empty cloud account', async () => {
    const user = userEvent.setup()
    const enable = vi.fn().mockResolvedValue(undefined)
    const guestRepository = new IndexedDbBudgetRepository(new BudgetDatabase())
    await guestRepository.save(createInitialAppData())
    guestRepository.close()
    renderPage({
      client: {} as FinanceCloudClient,
      session,
      repository: { enable },
    })

    expect(
      screen.getByRole('heading', { name: 'pilot@example.invalid' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Sync status: not enabled — choose below.')).toBeVisible()
    await user.click(
      await screen.findByRole('button', {
        name: 'Import guest budgets and enable sync',
      }),
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(enable).not.toHaveBeenCalled()
    expect(screen.getByText(/Guest data on this browser: 1 budget month/)).toBeVisible()
  })

  it('offers both versions when sync is in conflict and confirms before replacing', async () => {
    const user = userEvent.setup()
    const useRemote = vi.fn().mockResolvedValue(undefined)
    renderPage({
      client: {} as FinanceCloudClient,
      session,
      sync: { status: 'conflict' },
      repository: { useRemote },
    })

    const region = screen.getByRole('region', {
      name: 'Changes on another device',
    })
    for (const name of ['Download local copy', 'Download cloud copy']) {
      expect(within(region).getByRole('button', { name })).toBeEnabled()
    }

    await user.click(within(region).getByRole('button', { name: 'Use cloud copy' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useRemote).not.toHaveBeenCalled()

    await user.click(within(region).getByRole('button', { name: 'Use cloud copy' }))
    const second = await screen.findByRole('alertdialog')
    await user.click(within(second).getByRole('button', { name: 'Use cloud copy' }))
    await waitFor(() => expect(useRemote).toHaveBeenCalledOnce())
  })
})
