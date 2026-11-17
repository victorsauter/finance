import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components/layout/Page'
import { BackupPage } from '@/features/backup/BackupPage'

export const Route = createFileRoute('/backup')({
  component: BackupRoute,
})

function BackupRoute() {
  // Wave 2: drop `as="div"` once the page no longer renders its own <main>.
  return (
    <Page as="div">
      <BackupPage />
    </Page>
  )
}
