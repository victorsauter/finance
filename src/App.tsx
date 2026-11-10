import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Database,
  LoaderCircle,
  ReceiptText,
  WalletCards,
  UserRound,
  type LucideProps,
} from 'lucide-react'
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { AuthProvider } from './app/AuthProvider'
import { BudgetScope } from './app/BudgetScope'
import { useAuth } from './app/auth-context'
import { useSync } from './app/sync-context'
import { useBudget, type SaveStatus } from './app/budget-context'
import { ThemeProvider } from './app/ThemeProvider'
import { ThemeSwitcher } from './components/ui/ThemeSwitcher'
import { BackupPage } from './features/backup/BackupPage'
import { BudgetPage } from './features/dashboard/BudgetPage'

const AccountPage = lazy(() =>
  import('./features/account/AccountPage').then((module) => ({
    default: module.AccountPage,
  })),
)

const TransactionsPage = lazy(() =>
  import('./features/transactions/TransactionsPage').then((module) => ({
    default: module.TransactionsPage,
  })),
)

const navigationItems: Array<{
  to: string
  label: string
  end?: boolean
  Icon: ComponentType<LucideProps>
}> = [
  { to: '/', label: 'Budget', end: true, Icon: WalletCards },
  { to: '/transactions', label: 'Transactions', Icon: ReceiptText },
  { to: '/backup', label: 'Backup', Icon: Database },
  { to: '/account', label: 'Account', Icon: UserRound },
]

const saveStatusContent: Record<
  SaveStatus,
  { label: string; Icon: ComponentType<LucideProps> }
> = {
  loading: { label: 'Opening…', Icon: LoaderCircle },
  saving: { label: 'Saving…', Icon: LoaderCircle },
  saved: { label: 'Saved locally', Icon: CheckCircle2 },
  error: { label: 'Save error', Icon: AlertCircle },
}

function ConnectionStatus({ compact = false }: { compact?: boolean }) {
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
      className={`offline-pill ${compact ? 'is-compact' : ''}`}
      aria-label={compact ? 'Offline' : undefined}
    >
      <CloudOff aria-hidden="true" size={14} />
      {!compact && 'Offline'}
    </span>
  )
}

function SaveStatusIndicator({
  status,
  compact = false,
}: {
  status: SaveStatus
  compact?: boolean
}) {
  const { label, Icon } = saveStatusContent[status]
  return (
    <span
      className={`save-status save-${status} ${compact ? 'is-compact' : ''}`}
      title="Local save status"
      aria-label={compact ? label : undefined}
    >
      <Icon aria-hidden="true" size={14} />
      {!compact && label}
    </span>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <NavLink
      to="/"
      className={`brand ${compact ? 'is-compact' : ''}`}
      aria-label="Finance, home"
    >
      <span className="brand-mark" aria-hidden="true">
        <WalletCards size={compact ? 19 : 23} strokeWidth={2.15} />
      </span>
      <span className="brand-copy">
        Finance
        <small>Simple. Private. Always with you.</small>
      </span>
    </NavLink>
  )
}

function Navigation({
  className,
  label,
}: {
  className: string
  label: string
}) {
  return (
    <nav className={className} aria-label={label}>
      {navigationItems.map(({ to, label: itemLabel, end, Icon }) => (
        <NavLink key={to} to={to} end={end}>
          <span className="nav-icon" aria-hidden="true">
            <Icon size={21} strokeWidth={2.15} />
          </span>
          <span>{itemLabel}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function AppShell() {
  const { saveStatus, error, dismissError } = useBudget()
  const { session } = useAuth()
  const { state: sync } = useSync()

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar glass-panel">
        <Brand />
        <Navigation className="sidebar-nav" label="Main navigation" />
        <div className="sidebar-meta">
          <div className="sidebar-status" aria-live="polite">
            <ConnectionStatus />
            <SaveStatusIndicator status={saveStatus} />
          </div>
          <ThemeSwitcher />
          <p>{session ? `Cloud sync: ${sync.status}` : 'Your guest data stays on this device.'}</p>
        </div>
      </aside>

      <header className="mobile-header glass-panel">
        <div className="mobile-brand-row">
          <Brand compact />
          <div className="mobile-status" aria-live="polite">
            <ConnectionStatus compact />
            <SaveStatusIndicator status={saveStatus} compact />
          </div>
        </div>
        <ThemeSwitcher compact />
      </header>

      <div className="app-canvas">
        {session && sync.status !== 'synced' && <div className="notice account-sync-notice" role="status">
          {sync.status === 'disabled' ? 'Cloud sync needs your confirmation.'
            : sync.status === 'conflict' ? 'Sync paused: another device has newer changes.'
              : sync.status === 'error' ? 'Cloud sync failed. Local changes are safe.'
                : sync.status === 'syncing' ? 'Syncing your account…' : 'Local changes are waiting to sync.'}{' '}
          <NavLink to="/account">Manage sync</NavLink>
        </div>}
        {error && (
          <div className="global-error" role="alert">
            <AlertCircle aria-hidden="true" size={17} />
            <span>{error}</span>
            <button type="button" onClick={dismissError}>
              Close
            </button>
          </div>
        )}

        <Suspense
          fallback={
            <main className="content-page route-loading" aria-live="polite">
              <LoaderCircle
                className="spin"
                aria-hidden="true"
                size={20}
              />
              Loading…
            </main>
          }
        >
          <Routes>
            <Route path="/" element={<BudgetPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/operations" element={<Navigate to="/transactions" replace />} />
            <Route path="/sauvegarde" element={<Navigate to="/backup" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        <footer className="app-footer">
          <span>{session ? 'Private account data. Offline edits sync when connected.' : 'Local and private guest data.'}</span>
          <NavLink to="/backup">Create a backup</NavLink>
        </footer>
      </div>

      <Navigation className="mobile-dock glass-panel" label="Mobile navigation" />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <BudgetScope>
            <AppShell />
          </BudgetScope>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
