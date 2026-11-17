import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components/layout/Page'
import { AccountPage } from '@/features/account/AccountPage'

export const Route = createFileRoute('/account')({
  component: AccountRoute,
})

function AccountRoute() {
  return (
    <Page>
      <AccountPage />
    </Page>
  )
}
