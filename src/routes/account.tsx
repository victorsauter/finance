import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components/layout/Page'
import { AccountPage } from '@/features/account/AccountPage'

export const Route = createFileRoute('/account')({
  component: AccountRoute,
})

function AccountRoute() {
  // Wave 2: drop `as="div"` once the page no longer renders its own <main>.
  return (
    <Page as="div">
      <AccountPage />
    </Page>
  )
}
