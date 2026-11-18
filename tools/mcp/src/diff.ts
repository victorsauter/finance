/** One changed field of one transaction or budget entity. */
export interface Change {
  entity: 'transaction' | 'item' | 'document'
  id: string
  label: string
  field: string
  before: string
  after: string
}

export const MAX_DIFF_LINES = 40
export const MAX_DIFF_CHARS = 4000

export function changeLine(change: Change) {
  return `${change.label} [${change.field}]: ${change.before} -> ${change.after}`
}

/** Joins diff lines, keeping the output short enough to read in a chat. */
export function renderDiff(lines: string[]): string {
  const kept: string[] = []
  let length = 0
  for (const line of lines) {
    if (kept.length >= MAX_DIFF_LINES || length + line.length > MAX_DIFF_CHARS) break
    kept.push(line)
    length += line.length + 1
  }
  if (kept.length < lines.length) kept.push(`... and ${lines.length - kept.length} more line(s)`)
  return kept.join('\n')
}
