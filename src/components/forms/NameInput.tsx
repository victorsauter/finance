import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { quietInputClass } from './quiet-input'

interface NameInputProps {
  value: string
  onCommit: (value: string) => void
  ariaLabel: string
  className?: string
  /** Focus the field and select its text when it mounts (new rows). */
  autoFocus?: boolean
}

/**
 * Text field that edits a draft while focused and commits on blur or Enter.
 * An empty name is rejected with an inline error and stays in the field.
 */
export function NameInput({
  value,
  onCommit,
  ariaLabel,
  className,
  autoFocus = false,
}: NameInputProps) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()

  useEffect(() => {
    if (!autoFocus) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [autoFocus])

  const commit = () => {
    const normalized = draft.trim()
    if (!normalized) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setEditing(false)
    if (normalized !== value) onCommit(normalized)
  }

  return (
    <div className="min-w-0">
      <Input
        ref={inputRef}
        className={cn(quietInputClass, className)}
        type="text"
        maxLength={100}
        value={editing ? draft : value}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onFocus={() => {
          if (!editing) {
            setDraft(value)
            setEditing(true)
          }
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          setEditing(true)
          if (event.target.value.trim()) setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {invalid && (
        <p id={errorId} role="alert" className="px-2 pt-1 text-xs text-destructive">
          A name is required.
        </p>
      )}
    </div>
  )
}
