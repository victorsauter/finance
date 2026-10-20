export function formatTransactionAmount(
  amountCents: number,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountCents / 100)
  } catch {
    return `${(amountCents / 100).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency}`
  }
}

export function formatTransactionDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(year!, month! - 1, day!))
}

export function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  const label = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year!, month! - 1, 1))
  return label.charAt(0).toUpperCase() + label.slice(1)
}
