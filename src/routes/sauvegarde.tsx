import { createFileRoute, redirect } from '@tanstack/react-router'

// Legacy URL, kept so old bookmarks keep working.
export const Route = createFileRoute('/sauvegarde')({
  beforeLoad: () => {
    throw redirect({ to: '/backup', replace: true })
  },
})
