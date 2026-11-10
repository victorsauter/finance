import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../app/auth-context'
import { useBudget } from '../../app/budget-context'
import { useSync } from '../../app/sync-context'
import { BudgetDatabase } from '../../data/indexeddb/database'
import { IndexedDbBudgetRepository } from '../../data/indexeddb/IndexedDbBudgetRepository'
import type { AppData } from '../../domain/budget/models'
import type { CloudSnapshot } from '../../data/cloud/types'
import { downloadJson } from '../backup/download'

function counts(data: AppData) {
  return `${data.budgetMonths.length} budget month(s) and ${data.importedTransactions.length} transaction(s)`
}

export function AccountPage() {
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
    const question = remote
      ? 'Replace this device’s account budgets with its cloud copy? A JSON backup of this account’s current local budgets will be downloaded first. Guest budgets stay separate.'
      : `Upload ${counts(source)} to your private Supabase account and enable sync? Future edits and confirmed resets will sync across devices.`
    if (!window.confirm(question)) return
    if (importGuest || remote) downloadJson('finance-before-cloud-import.json', source)
    await repository.enable(importGuest ? source : undefined)
    setMessage('Cloud sync is enabled. Check the sync status before closing this device.')
  })

  return <main className="content-page narrow-page account-page">
    <div className="page-intro">
      <p className="eyebrow">Private cloud sync</p><h1>Account and sync</h1>
      <p>Keep your budgets across devices. Guest data stays on this browser until you explicitly import it into your account.</p>
    </div>
    {(error || authError || state.error) && <p className="notice notice-error" role="alert">{error ?? authError ?? state.error}</p>}
    {message && <p className="notice notice-success" role="status">{message}</p>}
    {!client ? <section className="settings-card"><div>
      <h2>Local mode</h2><p>Cloud sync is not configured for this deployment. Your local budgets and JSON backups remain available.</p>
    </div></section> : !session ? <section className="settings-card account-section">
      <h2>Sign in or create an account</h2>
      <form onSubmit={sendLink} className="account-form">
        <label>Email address<input type="email" autoComplete="email" value={email} required
          onChange={(event) => { setEmail(event.target.value); setSent(false) }} /></label>
        <button type="submit" className="primary-button" disabled={busy}>{sent ? 'Send another email' : 'Email me a sign-in link'}</button>
      </form>
      {sent && <form onSubmit={verify} className="account-form">
        <label>Email code<input value={code} onChange={(event) => setCode(event.target.value)}
          autoComplete="one-time-code" inputMode="numeric" required /></label>
        <button type="submit" className="secondary-button" disabled={busy}>Verify code</button>
      </form>}
      <p>Signing in does not upload your guest budgets automatically.</p>
    </section> : <>
      <section className="settings-card account-section">
        <h2>{session.user.email ?? 'Your account'}</h2>
        <p>Current account cache: {counts(data)}.</p>
        <p role="status">Sync status: {state.status === 'disabled' ? 'not enabled — choose below' : state.status}.</p>
        <div className="account-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
            if (!window.confirm('Sign out on this device? Pending changes stay in this account’s local cache. Sign back into the same account to sync them. Guest data will remain separate.')) return
            await signOut()
          })}>Sign out on this device</button>
          {state.status !== 'disabled' && <button className="secondary-button" disabled={busy || state.status === 'syncing'}
            onClick={() => void run(async () => { await repository?.sync() })}>Sync now</button>}
        </div>
      </section>
      {state.status === 'disabled' && <section className="settings-card account-section">
        <h2>Enable cloud sync</h2>
        {remote === undefined ? <><p>Cloud data has not been checked yet. An internet connection is required to enable sync.</p>
          <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
            setRemote(await repository!.inspectRemote())
          })}>Check cloud data again</button></>
          : remote ? <><p>This account already contains {counts(remote.data)}. Your guest data will not replace it.</p>
            <button className="primary-button" disabled={busy} onClick={() => enable(false)}>Use this account’s cloud budgets</button></>
          : <>
            <p>This cloud account is empty. Choose what to upload. A JSON copy is downloaded before importing guest data.</p>
            {guest && <><p>Guest data on this browser: {counts(guest)}.</p>
              <button className="primary-button" disabled={busy} onClick={() => enable(true)}>Import guest budgets and enable sync</button></>}
            <button className="secondary-button" disabled={busy} onClick={() => enable(false)}>Enable sync with current account budgets</button>
          </>}
      </section>}
      {state.status === 'conflict' && <section className="settings-card account-section">
        <h2>Changes on another device</h2>
        <p>Your local edits are safe. Whole-budget sync stops when another device has saved a newer version. Compare the JSON copies before choosing which version to keep.</p>
        <div className="account-actions">
          <button className="secondary-button" onClick={() => downloadJson('finance-local-conflict.json', data)}>Download local copy</button>
          <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
            const copy = await repository?.inspectRemote()
            if (copy) downloadJson('finance-cloud-conflict.json', copy.data)
          })}>Download cloud copy</button>
          <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
            if (!window.confirm('Replace this device’s pending edits with the latest cloud copy? A local backup will be downloaded first.')) return
            downloadJson('finance-before-cloud-replace.json', data)
            await repository?.useRemote()
          })}>Use cloud copy</button>
          <button className="danger-button" disabled={busy} onClick={() => void run(async () => {
            if (!window.confirm('Replace the conflicting cloud version with this local copy? Its JSON backup will be downloaded first.')) return
            const copy = await repository?.inspectRemote()
            if (copy) downloadJson('finance-before-local-replace.json', copy.data)
            await repository?.keepLocal()
          })}>Keep local copy</button>
        </div>
      </section>}
    </>}
    <section className="settings-card account-section"><h2>How your data is stored</h2>
      <p>Enabled sync sends confirmed budgets and transaction records to your private Supabase account. Original CSV files are parsed on your device. Local changes remain available offline, but are only backed up remotely after the status says synced.</p>
      <p>Account data cached on this browser is shown only after signing into that account. On shared devices, use a private browser session and export important backups. Synchronisation is not a historical backup: confirmed deletes and restores propagate to your other devices.</p>
    </section>
  </main>
}
