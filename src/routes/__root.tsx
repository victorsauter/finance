import { createRootRoute, Navigate, Outlet } from '@tanstack/react-router'
import { BudgetScope } from '@/app/BudgetScope'
import { AppShell } from '@/components/layout/AppShell'

/**
 * Root layout. Order matters and mirrors the previous app: the router sits
 * inside ThemeProvider / ConfirmProvider / AuthProvider (see App.tsx), and the
 * budget scope (sync + BudgetProvider) wraps the shell and every route.
 */
export const Route = createRootRoute({
  component: RootLayout,
  // Unknown URLs go home, like the previous catch-all route.
  notFoundComponent: () => <Navigate to="/" replace />,
})

function RootLayout() {
  return (
    <BudgetScope>
      <AppShell>
        <Outlet />
      </AppShell>
    </BudgetScope>
  )
}
