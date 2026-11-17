import { ZodError } from 'zod'

const MAX_ISSUES_SHOWN = 3

/**
 * Turns a restore failure into one readable sentence. A ZodError's own message
 * is a JSON dump of every issue, which is unreadable in a notice.
 */
export function describeBackupError(error: unknown): string {
  if (error instanceof ZodError) {
    const shown = error.issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    const hidden = error.issues.length - shown.length
    return `Invalid backup. ${shown.join('; ')}${hidden > 0 ? ` (and ${hidden} more)` : ''}`
  }
  if (error instanceof SyntaxError) {
    return 'Invalid backup: the file is not valid JSON.'
  }
  return error instanceof Error
    ? `Invalid backup: ${error.message}`
    : 'This file does not contain a valid backup.'
}
