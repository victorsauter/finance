import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BudgetContext, type BudgetContextValue } from '@/app/budget-context'
import { SyncContext } from '@/app/sync-context'
import { Page } from '@/components/layout/Page'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import { createInitialAppData } from '@/domain/budget/factory'
import type { SyncState } from '@/data/cloud/types'
import { BackupPage } from './BackupPage'

vi.mock('./download', () => ({ downloadJson: vi.fn() }))

afterEach(cleanup)

function renderPage(sync: SyncState = { status: 'disabled' }) {
  const data = createInitialAppData()
  const resetData = vi.fn().mockResolvedValue(undefined)
  const replaceData = vi.fn().mockResolvedValue(undefined)
  const budget = { data, resetData, replaceData } as unknown as BudgetContextValue
  render(
    <ConfirmProvider>
      <SyncContext.Provider value={{ repository: null, state: sync }}>
        <BudgetContext.Provider value={budget}>
          <Page>
            <BackupPage />
          </Page>
        </BudgetContext.Provider>
      </SyncContext.Provider>
    </ConfirmProvider>,
  )
  return { resetData, replaceData }
}

describe('BackupPage', () => {
  it('renders the shared page header and three labelled sections', () => {
    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Backup and restore' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    for (const name of ['Download a copy', 'Import a backup', 'Reset the app']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    expect(
      screen.getByRole('button', { name: 'Download JSON' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeVisible()
  })

  it('describes cloud sync only when it is enabled', () => {
    renderPage({ status: 'synced' })

    expect(screen.getByText(/not a historical backup/)).toBeInTheDocument()
    expect(screen.getByText(/in this synced account/)).toBeInTheDocument()
  })

  it('resets only after confirmation', async () => {
    const user = userEvent.setup()
    const { resetData } = renderPage()

    await user.click(screen.getByRole('button', { name: 'Reset everything' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(resetData).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Reset everything' }))
    const second = await screen.findByRole('alertdialog')
    await user.click(
      within(second).getByRole('button', { name: 'Reset everything' }),
    )
    await waitFor(() => expect(resetData).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Local data has been reset.',
    )
  })

  it('reports an invalid backup file as an alert and keeps the data', async () => {
    const user = userEvent.setup()
    const { replaceData } = renderPage()

    await user.upload(
      screen.getByLabelText('Backup file', { selector: 'input' }),
      new File(['not json'], 'broken.json', { type: 'application/json' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid backup: the file is not valid JSON.',
    )
    expect(replaceData).not.toHaveBeenCalled()
  })
})
