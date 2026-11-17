import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatMoneyInput, parseMoneyInput } from '../../domain/budget/money'
import { quietInputClass } from './quiet-input'

interface MoneyInputProps {
  valueCents: number
  onCommit: (valueCents: number) => void
  ariaLabel: string
  className?: string
}

/**
 * Amount field (euros, comma or dot) that edits a draft while focused and
 * commits on blur or Enter. Right-aligned with a fixed € suffix.
 */
export function MoneyInput({
  valueCents,
  onCommit,
  ariaLabel,
  className,
}: MoneyInputProps) {
  const [draft, setDraft] = useState(() => formatMoneyInput(valueCents))
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const errorId = useId()

  const commit = () => {
    const parsed = parseMoneyInput(draft)
    if (parsed === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setDraft(formatMoneyInput(parsed))
    setEditing(false)
    if (parsed !== valueCents) onCommit(parsed)
  }

  return (
    <div className={cn('min-w-0', className)}>
      <div className="relative">
        <Input
          className={cn(quietInputClass, 'pr-7 text-right tabular-nums')}
          type="text"
          inputMode="decimal"
          value={editing ? draft : formatMoneyInput(valueCents)}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onFocus={() => {
            if (!editing) {
              setDraft(formatMoneyInput(valueCents))
              setEditing(true)
            }
          }}
          onChange={(event) => {
            setDraft(event.target.value)
            setEditing(true)
            setInvalid(false)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground"
        >
          €
        </span>
      </div>
      {invalid && (
        <p
          id={errorId}
          role="alert"
          className="px-2 pt-1 text-right text-xs text-destructive"
        >
          Enter an amount up to 1,000,000,000.
        </p>
      )}
    </div>
  )
}
