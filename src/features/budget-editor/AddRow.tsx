import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'

interface AddRowProps {
  onClick: () => void
  /** Text after the plus sign, e.g. "Add income". */
  children: ReactNode
}

/** The single dashed "+ Add …" row at the bottom of a list. */
export function AddRow({ onClick, children }: AddRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors outline-none hover:border-ring hover:bg-muted/50 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Plus aria-hidden="true" className="size-4" />
      {children}
    </button>
  )
}
