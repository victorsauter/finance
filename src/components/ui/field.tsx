import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FieldProps {
  label: ReactNode
  /** Help text shown under the control and linked to it. */
  hint?: ReactNode
  /** Validation message; marks the control invalid. */
  error?: ReactNode
  className?: string
  /** Receives the id and aria attributes to spread on the control. */
  children: (control: FieldControlProps) => ReactNode
}

/**
 * Label + control + hint/error, wired together for assistive technologies.
 * Use it for every form field so labels and messages look the same everywhere.
 */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
