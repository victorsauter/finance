import { useEffect, useState, type ComponentType } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  LoaderCircle,
  type LucideProps,
} from 'lucide-react'
import type { SaveStatus } from '@/app/budget-context'
import { cn } from '@/lib/utils'

const pill =
  'inline-flex h-8 w-fit items-center gap-1.5 rounded-full border bg-card/50 px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground'
const compactPill = 'size-8 justify-center px-0'

const saveStatusContent: Record<
  SaveStatus,
  { label: string; Icon: ComponentType<LucideProps>; iconClass: string }
> = {
  loading: {
    label: 'Opening…',
    Icon: LoaderCircle,
    iconClass: 'animate-spin text-primary',
  },
  saving: {
    label: 'Saving…',
    Icon: LoaderCircle,
    iconClass: 'animate-spin text-primary',
  },
  saved: { label: 'Saved locally', Icon: CheckCircle2, iconClass: 'text-success' },
  error: { label: 'Save error', Icon: AlertCircle, iconClass: 'text-destructive' },
}

/** Shown only while the browser is offline. */
export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (online) return null
  return (
    <span
      className={cn(pill, 'text-warning', compact && compactPill)}
      aria-label={compact ? 'Offline' : undefined}
    >
      <CloudOff aria-hidden="true" className="size-3.5" />
      {!compact && <span>Offline</span>}
    </span>
  )
}

/** Local persistence state of the budget document. */
export function SaveStatusIndicator({
  status,
  compact = false,
}: {
  status: SaveStatus
  compact?: boolean
}) {
  const { label, Icon, iconClass } = saveStatusContent[status]
  return (
    <span
      className={cn(pill, compact && compactPill)}
      title="Local save status"
      aria-label={compact ? label : undefined}
    >
      <Icon aria-hidden="true" className={cn('size-3.5', iconClass)} />
      {!compact && label}
    </span>
  )
}
