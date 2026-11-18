import { useState } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { AuthProvider } from './app/AuthProvider'
import { ThemeProvider } from './app/ThemeProvider'
import { ConfirmProvider } from './components/ui/ConfirmProvider'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { createAppRouter } from './router'

/**
 * Provider order (outermost first): theme, confirm dialogs, auth, router. The
 * budget scope (sync + budget state) and the app shell live in the root route
 * (src/routes/__root.tsx), inside the router, as before.
 */
function App() {
  const [router] = useState(createAppRouter)

  return (
    <ThemeProvider>
      <TooltipProvider>
        <ConfirmProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ConfirmProvider>
        <Toaster position="top-center" />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
