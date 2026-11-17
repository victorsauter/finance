import { Suspense, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  WalletCards,
} from 'lucide-react'
import { useAuth } from '@/app/auth-context'
import { useBudget } from '@/app/budget-context'
import { useSync } from '@/app/sync-context'
import { Button } from '@/components/ui/button'
import { ThemeSwitcher } from '@/components/ui/ThemeSwitcher'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { pageContainerClass } from './container'
import { navItems } from './nav-items'
import { ConnectionStatus, SaveStatusIndicator } from './ShellStatus'

const SIDEBAR_STORAGE_KEY = 'finance-sidebar-collapsed'

function readSidebarPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      aria-label="Finance, home"
      className={cn(
        'flex w-fit min-w-0 items-center gap-3 rounded-xl font-bold tracking-tight text-foreground no-underline',
        compact && 'gap-2.5',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid shrink-0 place-items-center rounded-2xl border border-white/40 bg-brand text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_10px_24px_rgb(91_104_238/0.25)]',
          compact ? 'size-10 rounded-xl' : 'size-11',
        )}
      >
        <WalletCards
          className={compact ? 'size-5' : 'size-6'}
          strokeWidth={2.15}
        />
      </span>
      <span
        className={cn(
          'min-w-0 text-base leading-tight',
          compact && 'text-sm',
          '[[data-collapsed=true]_&]:hidden',
        )}
      >
        Finance
        {!compact && (
          <small className="mt-0.5 block truncate text-xs font-normal tracking-normal text-muted-foreground">
            Simple. Private. Always with you.
          </small>
        )}
      </span>
    </Link>
  )
}

const sidebarLinkClass = cn(
  'group/nav relative flex min-h-12 items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-sm font-semibold text-muted-foreground no-underline transition-colors',
  'hover:bg-card/60 hover:text-foreground',
  'data-[status=active]:border-primary/15 data-[status=active]:bg-accent data-[status=active]:text-accent-foreground',
  'group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-2',
)

const navIconClass = cn(
  'grid size-8 shrink-0 place-items-center rounded-lg transition-colors',
  'group-data-[status=active]/nav:bg-brand group-data-[status=active]/nav:text-white group-data-[status=active]/nav:shadow-[0_7px_16px_rgb(91_104_238/0.23)]',
)

function SidebarNav() {
  return (
    <nav aria-label="Main navigation" className="mt-8 grid gap-1.5">
      {navItems.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === '/' }}
          className={sidebarLinkClass}
          title={label}
        >
          <span aria-hidden="true" className={navIconClass}>
            <Icon className="size-5" strokeWidth={2.15} />
          </span>
          <span className="group-data-[collapsed=true]/sidebar:sr-only">
            {label}
          </span>
        </Link>
      ))}
    </nav>
  )
}

function MobileDock() {
  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        'glass-panel fixed left-1/2 z-(--z-dock) grid h-(--dock-height) w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 grid-cols-4 gap-1 rounded-[1.8rem] p-1.5 md:hidden',
        'bottom-[max(var(--dock-offset),env(safe-area-inset-bottom,0px))]',
      )}
    >
      {navItems.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === '/' }}
          className="group/nav grid min-w-0 place-items-center gap-0.5 rounded-3xl border border-transparent px-0.5 py-1 text-xs font-semibold text-muted-foreground no-underline data-[status=active]:border-primary/15 data-[status=active]:bg-accent/75 data-[status=active]:text-accent-foreground"
        >
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-full group-data-[status=active]/nav:bg-brand group-data-[status=active]/nav:text-white group-data-[status=active]/nav:shadow-[0_8px_18px_rgb(91_104_238/0.28)]"
          >
            <Icon className="size-5" strokeWidth={2.15} />
          </span>
          <span className="max-w-full truncate">{label}</span>
        </Link>
      ))}
    </nav>
  )
}

function SyncNotice() {
  const { session } = useAuth()
  const { state: sync } = useSync()
  if (!session || sync.status === 'synced') return null

  const message =
    sync.status === 'disabled'
      ? 'Cloud sync needs your confirmation.'
      : sync.status === 'conflict'
        ? 'Sync paused: another device has newer changes.'
        : sync.status === 'error'
          ? 'Cloud sync failed. Local changes are safe.'
          : sync.status === 'syncing'
            ? 'Syncing your account…'
            : 'Local changes are waiting to sync.'

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 rounded-xl border border-primary/20 bg-accent px-4 py-3 text-sm text-accent-foreground"
    >
      {message}
      <Link to="/account" className="font-semibold underline">
        Manage sync
      </Link>
    </div>
  )
}

function GlobalError() {
  const { error, dismissError } = useBudget()
  if (!error) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{error}</span>
      <Button type="button" variant="ghost" size="sm" onClick={dismissError}>
        Close
      </Button>
    </div>
  )
}

/**
 * Application frame: desktop sidebar (collapsible), mobile header and dock,
 * global banners, and the route content. Pages render inside `children` and
 * own nothing but their own content: wrap it in <Page>.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { saveStatus } = useBudget()
  const { session } = useAuth()
  const { state: sync } = useSync()

  // Below 1181px the sidebar is always collapsed to icons. Above, the person
  // chooses and the choice is remembered.
  const wide = useMediaQuery('(min-width: 73.8125rem)', true)
  const [userCollapsed, setUserCollapsed] = useState(readSidebarPreference)
  const collapsed = !wide || userCollapsed

  const toggleSidebar = () => {
    const next = !userCollapsed
    setUserCollapsed(next)
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
    } catch {
      // Not persisted: the sidebar still toggles for this visit.
    }
  }

  return (
    <div
      className="min-h-dvh"
      style={
        {
          '--sidebar-current': collapsed
            ? 'var(--sidebar-width-collapsed)'
            : 'var(--sidebar-width)',
        } as CSSProperties
      }
    >
      <aside
        data-collapsed={collapsed}
        className="group/sidebar glass-panel fixed inset-y-(--shell-inset) left-(--shell-inset) z-(--z-sidebar) hidden w-(--sidebar-current) flex-col rounded-[1.875rem] p-4 transition-[width] duration-200 ease-out md:flex data-[collapsed=true]:items-center data-[collapsed=true]:px-3"
      >
        <Brand />
        <div className="w-full">
          <SidebarNav />
        </div>
        <div className="mt-auto grid w-full gap-3">
          <div
            aria-live="polite"
            className="grid gap-1.5 group-data-[collapsed=true]/sidebar:justify-items-center"
          >
            <ConnectionStatus compact={collapsed} />
            <SaveStatusIndicator status={saveStatus} compact={collapsed} />
          </div>
          <ThemeSwitcher compact={collapsed} vertical={collapsed} />
          <p className="px-1 text-xs leading-snug text-muted-foreground group-data-[collapsed=true]/sidebar:hidden">
            {session
              ? `Cloud sync: ${sync.status}`
              : 'Your guest data stays on this device.'}
          </p>
          {wide && (
            <Button
              type="button"
              variant="ghost"
              size={collapsed ? 'icon' : 'default'}
              className="w-full justify-start text-muted-foreground group-data-[collapsed=true]/sidebar:justify-center"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              onClick={toggleSidebar}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <>
                  <PanelLeftClose aria-hidden="true" />
                  Collapse
                </>
              )}
            </Button>
          )}
        </div>
      </aside>

      <header
        className={cn(
          'glass-panel fixed inset-x-2 z-(--z-header) flex h-(--mobile-header-height) items-center justify-between gap-3 rounded-[1.35rem] py-2 pr-2 pl-3 sm:inset-x-3 md:hidden',
          'top-[max(var(--mobile-header-offset),env(safe-area-inset-top,0px))]',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Brand compact />
          <div aria-live="polite" className="flex items-center gap-1">
            <ConnectionStatus compact />
            <SaveStatusIndicator status={saveStatus} compact />
          </div>
        </div>
        <ThemeSwitcher compact />
      </header>

      <div
        className={cn(
          'flex min-h-dvh min-w-0 flex-col pt-(--mobile-top-clearance) pb-(--mobile-bottom-clearance)',
          'md:ml-[calc(var(--shell-inset)*2+var(--sidebar-current))] md:pt-0 md:pb-0 md:transition-[margin] md:duration-200',
        )}
      >
        <div
          className={cn(
            pageContainerClass,
            'sticky top-2 z-(--z-banner) flex flex-col gap-2 pt-4 empty:hidden md:top-3',
          )}
        >
          <SyncNotice />
          <GlobalError />
        </div>

        <Suspense
          fallback={
            <div
              className={cn(
                pageContainerClass,
                'flex items-center gap-2 py-8 text-sm text-muted-foreground',
              )}
              aria-live="polite"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-5 animate-spin"
              />
              Loading…
            </div>
          }
        >
          {children}
        </Suspense>

        <footer
          className={cn(
            pageContainerClass,
            'hidden items-center justify-center gap-2 py-6 text-xs text-muted-foreground md:flex',
          )}
        >
          <span>
            {session
              ? 'Private account data. Offline edits sync when connected.'
              : 'Local and private guest data.'}
          </span>
          <Link to="/backup" className="font-semibold text-accent-foreground">
            Create a backup
          </Link>
        </footer>
      </div>

      <MobileDock />
    </div>
  )
}
