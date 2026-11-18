import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/app/auth-context'
import { useBudget } from '@/app/budget-context'
import { useSync } from '@/app/sync-context'
import { PageHeader } from '@/components/layout/PageHeader'
import { Section } from '@/components/layout/Section'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { Separator } from '@/components/ui/separator'
import { touchControl } from '@/components/ui/touch'
import { cn } from '@/lib/utils'
import { BudgetDatabase } from '../../data/indexeddb/database'
import { IndexedDbBudgetRepository } from '../../data/indexeddb/IndexedDbBudgetRepository'
import type { AppData } from '../../domain/budget/models'
import type { CloudSnapshot, SyncStatus } from '../../data/cloud/types'
import { downloadJson } from '../backup/download'

function counts(data: AppData) {
  return `${data.budgetMonths.length} budget month(s) and ${data.importedTransactions.length} transaction(s)`
}

const syncStatusIcon: Record<SyncStatus, { Icon: LucideIcon; className: string }> = {
  disabled: { Icon: CloudOff, className: 'text-muted-foreground' },
  idle: { Icon: CheckCircle2, className: 'text-muted-foreground' },
  syncing: { Icon: LoaderCircle, className: 'animate-spin text-primary' },
  pending: { Icon: LoaderCircle, className: 'text-warning' },
  synced: { Icon: CheckCircle2, className: 'text-success' },
  conflict: { Icon: AlertCircle, className: 'text-warning' },
  error: { Icon: AlertCircle, className: 'text-destructive' },
}

/** A short labelled block inside a settings card. */
function Block({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {children}
    </div>
  )
}

/** Row of buttons: full width stacked on phones, inline from `sm`. */
function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{children}</div>
}

/** Summary box for counts (guest data, cloud data). */
function Preview({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border bg-muted/40 p-4 text-sm tabular-nums">
      {children}
    </p>
  )
}

export function AccountPage() {
  const confirm = useConfirm()
  const { client, session, error: authError, signOut } = useAuth()
  const { data } = useBudget()
  const { repository, state } = useSync()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guest, setGuest] = useState<AppData | null>(null)
  const [remote, setRemote] = useState<CloudSnapshot | null | undefined>(undefined)
  const errorId = useId()

  useEffect(() => {
    if (!repository) return
    let active = true
    const guestRepository = new IndexedDbBudgetRepository(new BudgetDatabase())
    void guestRepository.load().then((value) => { if (active) setGuest(value) })
      .catch(() => { if (active) setError('Unable to read guest data. Export a JSON backup in guest mode.') })
      .finally(() => guestRepository.close())
    void repository.inspectRemote().then((value) => { if (active) setRemote(value) })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Unable to reach Supabase.') })
    return () => { active = false }
  }, [repository])

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null)
    try { await action() } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The operation failed. Your local data has been kept.')
    } finally { setBusy(false) }
  }

  const sendLink = (event: FormEvent) => {
    event.preventDefault()
    if (!client) return
    void run(async () => {
      const { error } = await client.auth.signInWithOtp({ email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/account` } })
      if (error) throw error
      setSent(true)
      setMessage('Check your email for a sign-in link or code. Open the link on this device, or enter the code below.')
    })
  }

  const verify = (event: FormEvent) => {
    event.preventDefault()
    if (!client) return
    void run(async () => {
      const { error } = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
      if (error) throw error
    })
  }

  const enable = (importGuest: boolean) => void run(async () => {
    if (!repository) return
    const source = importGuest ? guest : data
    if (!source) return
    const confirmed = await confirm(remote
      ? {
        title: 'Use the cloud copy?',
        message: 'This device’s account budgets will be replaced by the cloud copy. A JSON backup of this account’s current local budgets is downloaded first. Guest budgets stay separate.',
        confirmLabel: 'Use cloud copy',
        tone: 'danger',
      }
      : {
        title: 'Enable cloud sync?',
        message: `${counts(source)} will be uploaded to your private Supabase account. Future edits and confirmed resets will sync across devices.`,
        confirmLabel: 'Upload and enable sync',
      })
    if (!confirmed) return
    if (importGuest || remote) downloadJson('finance-before-cloud-import.json', source)
    await repository.enable(importGuest ? source : undefined)
    setMessage('Cloud sync is enabled. Check the sync status before closing this device.')
  })

  const shownError = error ?? authError ?? state.error
  const StatusIcon = syncStatusIcon[state.status]

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Account and sync"
        description="Keep your budgets across devices. Guest data stays on this browser until you explicitly import it into your account."
      />

      {shownError && (
        <Notice tone="error" id={errorId}>
          {shownError}
        </Notice>
      )}
      {message && <Notice tone="success">{message}</Notice>}

      {!client ? (
        <Section title="Local mode">
          <p className="text-sm text-muted-foreground">
            Cloud sync is not configured for this deployment. Your local budgets and JSON backups remain available.
          </p>
        </Section>
      ) : !session ? (
        <Section
          title="Sign in or create an account"
          description="We email you a sign-in link and a code. No password to remember."
          contentClassName="flex flex-col gap-5"
        >
          <form
            onSubmit={sendLink}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Field label="Email address" className="sm:flex-1">
              {(control) => (
                <Input
                  {...control}
                  aria-describedby={shownError ? errorId : control['aria-describedby']}
                  className={touchControl}
                  type="email"
                  autoComplete="email"
                  value={email}
                  required
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setSent(false)
                  }}
                />
              )}
            </Field>
            <Button type="submit" className={cn(touchControl, 'sm:shrink-0')} disabled={busy}>
              {sent ? 'Send another email' : 'Email me a sign-in link'}
            </Button>
          </form>
          {sent && (
            <>
              <Separator />
              <form
                onSubmit={verify}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <Field label="Email code" className="sm:flex-1">
                  {(control) => (
                    <Input
                      {...control}
                      aria-describedby={shownError ? errorId : control['aria-describedby']}
                      className={touchControl}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      required
                    />
                  )}
                </Field>
                <Button
                  type="submit"
                  variant="outline"
                  className={cn(touchControl, 'sm:shrink-0')}
                  disabled={busy}
                >
                  Verify code
                </Button>
              </form>
            </>
          )}
          <p className="text-sm text-muted-foreground">
            Signing in does not upload your guest budgets automatically.
          </p>
        </Section>
      ) : (
        <>
          <Section
            title={session.user.email ?? 'Your account'}
            description={`Current account cache: ${counts(data)}.`}
            contentClassName="flex flex-col gap-5"
          >
            <p role="status" className="flex items-center gap-2 text-sm">
              <StatusIcon.Icon
                aria-hidden="true"
                className={cn('size-4 shrink-0', StatusIcon.className)}
              />
              Sync status: {state.status === 'disabled' ? 'not enabled — choose below' : state.status}.
            </p>
            <Separator />
            <Actions>
              <Button
                variant="outline"
                className={touchControl}
                disabled={busy}
                onClick={() => void run(async () => {
                  const confirmed = await confirm({
                    title: 'Sign out on this device?',
                    message: 'Pending changes stay in this account’s local cache. Sign back into the same account to sync them. Guest data will remain separate.',
                    confirmLabel: 'Sign out',
                  })
                  if (!confirmed) return
                  await signOut()
                })}
              >
                Sign out on this device
              </Button>
              {state.status !== 'disabled' && (
                <Button
                  variant="outline"
                  className={touchControl}
                  disabled={busy || state.status === 'syncing'}
                  onClick={() => void run(async () => { await repository?.sync() })}
                >
                  Sync now
                </Button>
              )}
            </Actions>
          </Section>

          {state.status === 'disabled' && (
            <Section
              title="Enable cloud sync"
              description={
                remote === undefined
                  ? 'Cloud data has not been checked yet. An internet connection is required to enable sync.'
                  : remote
                    ? `This account already contains ${counts(remote.data)}. Your guest data will not replace it.`
                    : 'This cloud account is empty. Choose what to upload. A JSON copy is downloaded before importing guest data.'
              }
              contentClassName="flex flex-col gap-5"
            >
              {remote === undefined ? (
                <Actions>
                  <Button
                    variant="outline"
                    className={touchControl}
                    disabled={busy}
                    onClick={() => void run(async () => {
                      setRemote(await repository!.inspectRemote())
                    })}
                  >
                    Check cloud data again
                  </Button>
                </Actions>
              ) : remote ? (
                <Actions>
                  <Button
                    className={touchControl}
                    disabled={busy}
                    onClick={() => enable(false)}
                  >
                    Use this account’s cloud budgets
                  </Button>
                </Actions>
              ) : (
                <>
                  {guest && (
                    <Block title="Guest data">
                      <Preview>Guest data on this browser: {counts(guest)}.</Preview>
                      <Actions>
                        <Button
                          className={touchControl}
                          disabled={busy}
                          onClick={() => enable(true)}
                        >
                          Import guest budgets and enable sync
                        </Button>
                      </Actions>
                    </Block>
                  )}
                  {guest && <Separator />}
                  <Block title={guest ? 'Current account' : undefined}>
                    <Actions>
                      <Button
                        variant="outline"
                        className={touchControl}
                        disabled={busy}
                        onClick={() => enable(false)}
                      >
                        Enable sync with current account budgets
                      </Button>
                    </Actions>
                  </Block>
                </>
              )}
            </Section>
          )}

          {state.status === 'conflict' && (
            <Section
              title="Changes on another device"
              description="Your local edits are safe. Whole-budget sync stops when another device has saved a newer version. Compare the JSON copies before choosing which version to keep."
              className="ring-warning/40"
              contentClassName="flex flex-col gap-5"
            >
              <Block title="Compare">
                <Actions>
                  <Button
                    variant="outline"
                    className={touchControl}
                    onClick={() => downloadJson('finance-local-conflict.json', data)}
                  >
                    Download local copy
                  </Button>
                  <Button
                    variant="outline"
                    className={touchControl}
                    disabled={busy}
                    onClick={() => void run(async () => {
                      const copy = await repository?.inspectRemote()
                      if (copy) downloadJson('finance-cloud-conflict.json', copy.data)
                    })}
                  >
                    Download cloud copy
                  </Button>
                </Actions>
              </Block>
              <Separator />
              <Block title="Choose a version">
                <Actions>
                  <Button
                    variant="destructive"
                    className={touchControl}
                    disabled={busy}
                    onClick={() => void run(async () => {
                      const confirmed = await confirm({
                        title: 'Replace your pending edits?',
                        message: 'This device’s pending edits will be replaced by the latest cloud copy. A local backup is downloaded first.',
                        confirmLabel: 'Use cloud copy',
                        tone: 'danger',
                      })
                      if (!confirmed) return
                      downloadJson('finance-before-cloud-replace.json', data)
                      await repository?.useRemote()
                    })}
                  >
                    Use cloud copy
                  </Button>
                  <Button
                    variant="destructive"
                    className={touchControl}
                    disabled={busy}
                    onClick={() => void run(async () => {
                      const confirmed = await confirm({
                        title: 'Replace the cloud version?',
                        message: 'The conflicting cloud version will be replaced by this local copy. Its JSON backup is downloaded first.',
                        confirmLabel: 'Keep local copy',
                        tone: 'danger',
                      })
                      if (!confirmed) return
                      const copy = await repository?.inspectRemote()
                      if (copy) downloadJson('finance-before-local-replace.json', copy.data)
                      await repository?.keepLocal()
                    })}
                  >
                    Keep local copy
                  </Button>
                </Actions>
              </Block>
            </Section>
          )}
        </>
      )}

      <Section
        title="How your data is stored"
        contentClassName="flex flex-col gap-3 text-sm text-muted-foreground"
      >
        <p>Enabled sync sends confirmed budgets and transaction records to your private Supabase account. Original CSV files are parsed on your device. Local changes remain available offline, but are only backed up remotely after the status says synced.</p>
        <p>Account data cached on this browser is shown only after signing into that account. On shared devices, use a private browser session and export important backups. Synchronisation is not a historical backup: confirmed deletes and restores propagate to your other devices.</p>
      </Section>
    </>
  )
}
