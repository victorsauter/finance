const euroFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatMoney(cents: number): string {
  return euroFormatter.format(cents / 100)
}

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)} %`
}

export function formatMoneyInput(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

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

  return Math.round(amount * 100)
}
