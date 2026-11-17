import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
 * In-app replacement for window.confirm, built on the shadcn alert dialog:
 * focus is trapped, Escape cancels, and screen readers announce an alert
 * dialog. Same `useConfirm` API as before (see confirm-context.ts).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  // `pending` keeps the last request mounted while the close animation runs;
  // `open` is what the dialog actually shows.
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [open, setOpen] = useState(false)
  const pendingRef = useRef<PendingConfirm | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // A second request replaces the first one, which counts as cancelled.
        pendingRef.current?.resolve(false)
        const next = { options, resolve }
        pendingRef.current = next
        setPending(next)
        setOpen(true)
      }),
    [],
  )

  const settle = (confirmed: boolean) => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    setOpen(false)
    current.resolve(confirmed)
  }

  const options = pending?.options
  const danger = options?.tone === 'danger'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) settle(false)
        }}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen && !pendingRef.current) setPending(null)
        }}
      >
        {options && (
          <AlertDialogContent
            // Danger confirmations focus Cancel so Enter never destroys data.
            initialFocus={danger ? cancelRef : confirmRef}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{options.title}</AlertDialogTitle>
              <AlertDialogDescription>{options.message}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancelRef}>
                {options.cancelLabel ?? 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                ref={confirmRef}
                variant={danger ? 'destructive' : 'default'}
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}
