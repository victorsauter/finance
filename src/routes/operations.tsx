import { createFileRoute, redirect } from '@tanstack/react-router'

// Legacy URL, kept so old bookmarks keep working.
export const Route = createFileRoute('/operations')({
  beforeLoad: () => {
    throw redirect({ to: '/transactions', replace: true })
  },
})
