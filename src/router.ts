import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * One router per mounted <App />: tests mount the app several times and each
 * mount must read the current window location.
 */
export function createAppRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
