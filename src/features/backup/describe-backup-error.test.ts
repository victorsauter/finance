import { describe, expect, it } from 'vitest'
import { parseAppData } from '../../domain/budget/schema'
import { describeBackupError } from './describe-backup-error'

function failure(value: unknown): unknown {
  try {
    parseAppData(value)
  } catch (error) {
    return error
  }
  throw new Error('Expected the value to be rejected.')
}

describe('describeBackupError', () => {
  it('summarises schema issues instead of dumping JSON', () => {
    const message = describeBackupError(failure({ schemaVersion: 2 }))
    expect(message.startsWith('Invalid backup.')).toBe(true)
    expect(message).not.toContain('"code"')
    expect(message.length).toBeLessThan(400)
  })

  it('explains files that are not JSON', () => {
    let error: unknown
    try {
      JSON.parse('not json')
    } catch (parseError) {
      error = parseError
    }
    expect(describeBackupError(error)).toBe(
      'Invalid backup: the file is not valid JSON.',
    )
  })

  it('falls back to a generic sentence for unknown errors', () => {
    expect(describeBackupError('boom')).toBe(
      'This file does not contain a valid backup.',
    )
  })
})
