import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` styles the confirm button as destructive and focuses Cancel. */
  tone?: 'default' | 'danger'
}

/** Resolves to true when the user confirms, false on cancel or Escape. */
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider.')
  return confirm
}
