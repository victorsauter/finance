import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ConfirmContext,
  type ConfirmFn,
  type ConfirmOptions,
} from './confirm-context'

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
}

/**
 * In-app replacement for window.confirm: a native modal <dialog>, so focus is
 * trapped, Escape cancels, and screen readers announce it as a dialog.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // A second request replaces the first one, which counts as cancelled.
        pendingRef.current?.resolve(false)
        const next = { options, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!pending || !dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [pending])

  const settle = (confirmed: boolean) => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    dialogRef.current?.close()
    setPending(null)
    current.resolve(confirmed)
  }

  const options = pending?.options
  const danger = options?.tone === 'danger'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && options && (
        <dialog
          ref={dialogRef}
          className="confirm-dialog glass-panel"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
          onCancel={(event) => {
            event.preventDefault()
            settle(false)
          }}
          onClick={(event) => {
            // A click on the backdrop lands on the dialog element itself.
            if (event.target === event.currentTarget) settle(false)
          }}
        >
          <div className="confirm-body">
          <h2 id="confirm-title">{options.title}</h2>
          <p id="confirm-message">{options.message}</p>
          <div className="confirm-actions">
            <button
              type="button"
              className="secondary-button"
              autoFocus={danger}
              onClick={() => settle(false)}
            >
              {options.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={danger ? 'danger-button' : 'primary-button'}
              autoFocus={!danger}
              onClick={() => settle(true)}
            >
              {options.confirmLabel ?? 'Confirm'}
            </button>
          </div>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  )
}
