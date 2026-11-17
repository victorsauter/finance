const euroFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatMoney(cents: number): string {
  return euroFormatter.format(cents / 100)
}

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`
}

export function formatMoneyInput(cents: number): string {
  return (cents / 100).toLocaleString('en-GB', {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Largest amount accepted in a budget field: one billion euros. Without a cap a
 * pasted 20-digit number is no longer a safe integer, the schema rejects the
 * whole document, and every later save fails until the page is reloaded.
 */
export const MAX_AMOUNT_CENTS = 100_000_000_000

export function parseMoneyInput(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.')
  if (normalized === '') {
    return 0
  }

  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) {
    return null
  }

  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) {
    return null
  }

  const cents = Math.round(amount * 100)
  return cents > MAX_AMOUNT_CENTS ? null : cents
}
