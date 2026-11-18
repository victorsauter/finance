import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface RenameMonthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current name of the month, used as the starting value. */
  name: string
  onRename: (name: string) => void
}

/** Lets a month carry its own title (for example "Holiday month"). */
export function RenameMonthDialog({
  open,
  onOpenChange,
  name,
  onRename,
}: RenameMonthDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Remount on each opening so the field restarts from the saved name. */}
        {open && (
          <RenameForm
            name={name}
            onCancel={() => onOpenChange(false)}
            onSubmit={(next) => {
              onRename(next)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({
  name,
  onCancel,
  onSubmit,
}: {
  name: string
  onCancel: () => void
  onSubmit: (name: string) => void
}) {
  const [draft, setDraft] = useState(name)
  const trimmed = draft.trim()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Rename month</DialogTitle>
        <DialogDescription>
          The title shown for this month. The date does not change.
        </DialogDescription>
      </DialogHeader>
      <Field
        label="Month name"
        error={trimmed ? undefined : 'Enter a name for this month.'}
      >
        {(control) => (
          <Input
            {...control}
            className="h-11"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
