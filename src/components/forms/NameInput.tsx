import { useState } from 'react'

interface NameInputProps {
  value: string
  onCommit: (value: string) => void
  ariaLabel: string
  className?: string
}

export function NameInput({
  value,
  onCommit,
  ariaLabel,
  className,
}: NameInputProps) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)

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
    <span className="field-stack">
      <input
        className={className}
        type="text"
        value={editing ? draft : value}
        aria-label={ariaLabel}
        aria-invalid={invalid}
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
      {invalid && <span className="field-error">Le nom est obligatoire.</span>}
    </span>
  )
}
