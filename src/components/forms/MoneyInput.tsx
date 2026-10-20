import { useState } from 'react'
import { formatMoneyInput, parseMoneyInput } from '../../domain/budget/money'

interface MoneyInputProps {
  valueCents: number
  onCommit: (valueCents: number) => void
  ariaLabel: string
}

export function MoneyInput({
  valueCents,
  onCommit,
  ariaLabel,
}: MoneyInputProps) {
  const [draft, setDraft] = useState(() => formatMoneyInput(valueCents))
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)

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
    <span className="money-field">
      <input
        type="text"
        inputMode="decimal"
        value={editing ? draft : formatMoneyInput(valueCents)}
        aria-label={ariaLabel}
        aria-invalid={invalid}
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
      <span aria-hidden="true">€</span>
      {invalid && (
        <span className="field-error">Saisissez un montant positif.</span>
      )}
    </span>
  )
}
