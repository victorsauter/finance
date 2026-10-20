import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Database,
  LoaderCircle,
  ReceiptText,
  WalletCards,
  type LucideProps,
} from 'lucide-react'
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { BudgetProvider } from './app/BudgetContext'
import { useBudget, type SaveStatus } from './app/budget-context'
import { ThemeProvider } from './app/ThemeProvider'
import { ThemeSwitcher } from './components/ui/ThemeSwitcher'
import { BackupPage } from './features/backup/BackupPage'
import { BudgetPage } from './features/dashboard/BudgetPage'

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
  { to: '/operations', label: 'Opérations', Icon: ReceiptText },
  { to: '/sauvegarde', label: 'Sauvegarde', Icon: Database },
]

const saveStatusContent: Record<
  SaveStatus,
  { label: string; Icon: ComponentType<LucideProps> }
> = {
  loading: { label: 'Ouverture…', Icon: LoaderCircle },
  saving: { label: 'Enregistrement…', Icon: LoaderCircle },
  saved: { label: 'Enregistré localement', Icon: CheckCircle2 },
  error: { label: 'Erreur de sauvegarde', Icon: AlertCircle },
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
      aria-label={compact ? 'Hors connexion' : undefined}
    >
      <CloudOff aria-hidden="true" size={14} />
      {!compact && 'Hors connexion'}
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
      title="État de la sauvegarde locale"
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
      aria-label="Mon Budget, accueil"
    >
      <span className="brand-mark" aria-hidden="true">
        <WalletCards size={compact ? 19 : 23} strokeWidth={2.15} />
      </span>
      <span className="brand-copy">
        Mon Budget
        <small>Simple. Privé. Toujours avec vous.</small>
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

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar glass-panel">
        <Brand />
        <Navigation className="sidebar-nav" label="Navigation principale" />
        <div className="sidebar-meta">
          <div className="sidebar-status" aria-live="polite">
            <ConnectionStatus />
            <SaveStatusIndicator status={saveStatus} />
          </div>
          <ThemeSwitcher />
          <p>Vos données restent sur cet appareil.</p>
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
        {error && (
          <div className="global-error" role="alert">
            <AlertCircle aria-hidden="true" size={17} />
            <span>{error}</span>
            <button type="button" onClick={dismissError}>
              Fermer
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
              Chargement…
            </main>
          }
        >
          <Routes>
            <Route path="/" element={<BudgetPage />} />
            <Route path="/operations" element={<TransactionsPage />} />
            <Route path="/sauvegarde" element={<BackupPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        <footer className="app-footer">
          <span>Données locales et privées.</span>
          <NavLink to="/sauvegarde">Créer une sauvegarde</NavLink>
        </footer>
      </div>

      <Navigation className="mobile-dock glass-panel" label="Navigation mobile" />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <BudgetProvider>
          <AppShell />
        </BudgetProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
