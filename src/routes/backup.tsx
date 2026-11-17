import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components/layout/Page'
import { BackupPage } from '@/features/backup/BackupPage'

export const Route = createFileRoute('/backup')({
  component: BackupRoute,
})

function BackupRoute() {
  return (
    <Page>
      <BackupPage />
    </Page>
  )
}
