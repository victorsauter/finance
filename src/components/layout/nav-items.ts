import type { ComponentType } from 'react'
import {
  Database,
  ReceiptText,
  UserRound,
  WalletCards,
  type LucideProps,
} from 'lucide-react'

export interface NavItem {
  to: '/' | '/transactions' | '/backup' | '/account'
  label: string
  Icon: ComponentType<LucideProps>
}

/** Primary navigation, shared by the sidebar and the mobile dock. */
export const navItems: NavItem[] = [
  { to: '/', label: 'Budget', Icon: WalletCards },
  { to: '/transactions', label: 'Transactions', Icon: ReceiptText },
  { to: '/backup', label: 'Backup', Icon: Database },
  { to: '/account', label: 'Account', Icon: UserRound },
]
