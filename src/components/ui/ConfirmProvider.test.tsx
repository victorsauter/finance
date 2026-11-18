import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ConfirmProvider } from './ConfirmProvider'
import { useConfirm, type ConfirmOptions } from './confirm-context'

function Harness({ options }: { options: ConfirmOptions }) {
  const confirm = useConfirm()
  const [result, setResult] = useState('none')
  return (
    <>
      <button
        type="button"
        onClick={async () => setResult(String(await confirm(options)))}
      >
        Ask
      </button>
      <output>{result}</output>
    </>
  )
}

function renderHarness(options: ConfirmOptions) {
  return render(
    <ConfirmProvider>
      <Harness options={options} />
    </ConfirmProvider>,
  )
}

describe('ConfirmProvider', () => {
  it('resolves true when the person confirms', async () => {
    const user = userEvent.setup()
    renderHarness({ title: 'Delete?', message: 'This cannot be undone.' })

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Delete?' }),
    ).toHaveTextContent('This cannot be undone.')

    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('true'),
    )
  })

  it('resolves false on Escape and focuses Cancel for danger requests', async () => {
    const user = userEvent.setup()
    renderHarness({
      title: 'Delete?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByRole('alertdialog')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    )

    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('false'),
    )
  })
})
