import type { AppData } from '@/domain/budget/models'
import { parseAppData } from '@/domain/budget/schema'
import {
  canonicalizeAppData,
  documentToEntities,
  EntityConversionError,
  entitiesToDocument,
} from './convert'
import type { EntitySnapshot } from './rows'
import { entitySnapshotSchema } from './rows'

/**
 * The JSON text of a backup file: what the Backup page downloads. It is
 * declared here because the page writes it inline (`downloadJson` in
 * `features/backup`) and exposes no function for it.
 */
export function serializeBackup(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Returns the path of the first difference between two JSON-like values, or
 * null when they are deeply equal. Object key order does not matter.
 */
export function findFirstDifference(
  expected: unknown,
  actual: unknown,
  path = '$',
): string | null {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return path
    if (expected.length !== actual.length) return `${path}.length`
    for (let index = 0; index < expected.length; index += 1) {
      const difference = findFirstDifference(
        expected[index],
        actual[index],
        `${path}[${index}]`,
      )
      if (difference) return difference
    }
    return null
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    for (const key of keys.sort()) {
      if (!(key in expected) || !(key in actual)) return `${path}.${key}`
      const difference = findFirstDifference(
        expected[key],
        actual[key],
        `${path}.${key}`,
      )
      if (difference) return difference
    }
    return null
  }
  return Object.is(expected, actual) ? null : path
}

/** True when both documents are deeply equal. */
export function documentsAreEqual(expected: AppData, actual: AppData): boolean {
  return findFirstDifference(expected, actual) === null
}

function assertValidDocument(data: AppData) {
  try {
    parseAppData(data)
  } catch (error) {
    throw new EntityConversionError(
      'invalid-document',
      'The document is not valid and cannot be migrated.',
      { cause: error },
    )
  }
}

function assertValidSnapshot(snapshot: EntitySnapshot) {
  const result = entitySnapshotSchema.safeParse(snapshot)
  if (!result.success) {
    throw new EntityConversionError(
      'invalid-snapshot',
      'The snapshot does not match the row format.',
      { cause: result.error },
    )
  }
}

export interface DocumentMigration {
  /** The untouched document in the backup file format. */
  backupBefore: string
  snapshot: EntitySnapshot
  /** The document rebuilt from the snapshot, in the backup file format. */
  backupAfter: string
}

/**
 * Document to rows, guarded. It converts, converts back, and throws
 * `round-trip-mismatch` unless the rebuilt document deep-equals the canonical
 * form of the input. Pure: it returns both backups as text and writes nothing.
 * To roll back, restore `backupAfter` (or `backupBefore`).
 */
export function migrateDocumentToEntities(data: AppData): DocumentMigration {
  assertValidDocument(data)
  const backupBefore = serializeBackup(data)
  const snapshot = documentToEntities(data)
  const rebuilt = entitiesToDocument(snapshot)
  const difference = findFirstDifference(canonicalizeAppData(data), rebuilt)
  if (difference) {
    throw new EntityConversionError(
      'round-trip-mismatch',
      `The document does not survive the conversion (first difference at ${difference}).`,
    )
  }
  return { backupBefore, snapshot, backupAfter: serializeBackup(rebuilt) }
}

export interface EntityRollback {
  /** The snapshot as JSON, kept before it is turned back into a document. */
  backupBefore: string
  document: AppData
  /** The rebuilt document in the backup file format. */
  backupAfter: string
}

/** Rows to document, guarded by both schemas. Pure, like the migration. */
export function rollbackEntitiesToDocument(
  snapshot: EntitySnapshot,
): EntityRollback {
  assertValidSnapshot(snapshot)
  const document = entitiesToDocument(snapshot)
  return {
    backupBefore: serializeBackup(snapshot),
    document,
    backupAfter: serializeBackup(document),
  }
}
