import type {
  ImportedTransaction,
  ImportedTransactionKind,
} from '../budget/models'

type CsvDelimiter = ',' | ';' | '\t'

interface CsvRecord {
  line: number
  values: string[]
}

export type RevolutCsvIssueReason =
  | 'duplicate'
  | 'invalid'
  | 'pending'
  | 'rejected'

export interface RevolutCsvIssue {
  line: number
  reason: RevolutCsvIssueReason
  message: string
}

export interface RevolutCsvResult {
  delimiter: CsvDelimiter
  rowCount: number
  transactions: ImportedTransaction[]
  issues: RevolutCsvIssue[]
}

interface ParseOptions {
  fileName: string
  importedAt?: string
  idFactory?: () => string
}

const HEADER_ALIASES = {
  type: ['type', 'transaction type', 'type de transaction'],
  product: ['product', 'produit'],
  startedAt: [
    'started date',
    'start date',
    'started at',
    'date de debut',
    'date debut',
  ],
  completedAt: [
    'completed date',
    'completion date',
    'completed at',
    'date de fin',
    'date completee',
  ],
  description: ['description', 'merchant', 'commercant', 'libelle'],
  amount: ['amount', 'montant'],
  fee: ['fee', 'fees', 'frais'],
  currency: ['currency', 'devise'],
  state: ['state', 'status', 'statut', 'etat'],
  balance: ['balance', 'solde'],
  reference: [
    'reference',
    'transaction reference',
    'payment reference',
    'reference de transaction',
  ],
} as const

type HeaderName = keyof typeof HEADER_ALIASES
type HeaderIndexes = Partial<Record<HeaderName, number>>

export class RevolutCsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RevolutCsvError'
  }
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{Letter}\p{Number}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ])
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (!inQuotes && (character === '\r' || character === '\n')) break
    if (!inQuotes && counts.has(character as CsvDelimiter)) {
      const delimiter = character as CsvDelimiter
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1)
    }
  }

  const [delimiter, count] = [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0] ?? [',', 0]
  if (count === 0) {
    throw new RevolutCsvError(
      'The CSV delimiter could not be detected. Use a Revolut CSV export.',
    )
  }
  return delimiter
}

function parseRecords(text: string, delimiter: CsvDelimiter): CsvRecord[] {
  const records: CsvRecord[] = []
  let values: string[] = []
  let value = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1

  const pushRecord = () => {
    values.push(value)
    if (values.some((cell) => cell.trim() !== '')) {
      records.push({ line: recordLine, values })
    }
    values = []
    value = ''
    recordLine = line
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (inQuotes || value.length === 0) {
        inQuotes = !inQuotes
      } else {
        value += character
      }
      continue
    }

    if (character === delimiter && !inQuotes) {
      values.push(value)
      value = ''
      continue
    }

    if ((character === '\r' || character === '\n') && !inQuotes) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      line += 1
      pushRecord()
      recordLine = line
      continue
    }

    if (character === '\n') line += 1
    value += character
  }

  if (inQuotes) {
    throw new RevolutCsvError(
      'The CSV contains an unclosed quoted field.',
    )
  }
  if (value.length > 0 || values.length > 0) pushRecord()
  return records
}

function resolveHeaders(headers: string[]): HeaderIndexes {
  const normalized = headers.map((header) =>
    normalizeText(header.replace(/^\uFEFF/, '')),
  )
  const indexes: HeaderIndexes = {}

  for (const [name, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [HeaderName, readonly string[]]
  >) {
    const index = normalized.findIndex((header) =>
      aliases.some((alias) => header === normalizeText(alias)),
    )
    if (index >= 0) indexes[name] = index
  }

  const missing = [
    indexes.description === undefined ? 'Description' : null,
    indexes.amount === undefined ? 'Amount' : null,
    indexes.currency === undefined ? 'Currency' : null,
    indexes.state === undefined ? 'State' : null,
    indexes.startedAt === undefined && indexes.completedAt === undefined
      ? 'Started Date or Completed Date'
      : null,
  ].filter((name): name is string => name !== null)

  if (missing.length > 0) {
    throw new RevolutCsvError(
      `Missing Revolut columns: ${missing.join(', ')}.`,
    )
  }
  return indexes
}

function cell(record: CsvRecord, indexes: HeaderIndexes, name: HeaderName) {
  const index = indexes[name]
  return index === undefined ? '' : (record.values[index] ?? '').trim()
}

function normalizeDecimal(value: string): string | null {
  let normalized = value
    .trim()
    .replace(/[\s\u00A0\u202F']/g, '')
  let negative = false

  if (normalized.startsWith('(') && normalized.endsWith(')')) {
    negative = true
    normalized = normalized.slice(1, -1)
  }
  if (!/^[+-]?\d+(?:[.,]\d+)*$/.test(normalized)) return null

  const explicitSign = normalized[0] === '-' ? '-' : ''
  normalized = normalized.replace(/^[+-]/, '')
  const lastComma = normalized.lastIndexOf(',')
  const lastDot = normalized.lastIndexOf('.')
  const separatorIndex = Math.max(lastComma, lastDot)

  if (separatorIndex >= 0) {
    const fractionLength = normalized.length - separatorIndex - 1
    const hasBothSeparators = lastComma >= 0 && lastDot >= 0
    const hasDecimal =
      fractionLength > 0 &&
      (fractionLength <= 2 || hasBothSeparators)

    if (hasDecimal) {
      const integerPart = normalized
        .slice(0, separatorIndex)
        .replace(/[.,]/g, '')
      const fractionPart = normalized
        .slice(separatorIndex + 1)
        .replace(/[.,]/g, '')
      normalized = `${integerPart}.${fractionPart}`
    } else {
      normalized = normalized.replace(/[.,]/g, '')
    }
  }

  return `${negative || explicitSign === '-' ? '-' : ''}${normalized}`
}

function parseCents(value: string, fieldName: string): number {
  const normalized = normalizeDecimal(value)
  if (normalized === null) {
    throw new Error(`Invalid ${fieldName}: “${value}”`)
  }
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error(`${fieldName} is out of range: “${value}”`)
  }
  return Math.round(amount * 100)
}

function parseOptionalCents(
  value: string,
  fieldName: string,
): number | null {
  if (value.trim() === '') return null
  return parseCents(value, fieldName)
}

function toIsoDate(value: string): string | null {
  const trimmed = value.trim()
  let year: number
  let month: number
  let day: number

  const yearFirst = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(trimmed)
  if (yearFirst) {
    year = Number(yearFirst[1])
    month = Number(yearFirst[2])
    day = Number(yearFirst[3])
  } else {
    const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(trimmed)
    if (!dayFirst) return null
    const first = Number(dayFirst[1])
    const second = Number(dayFirst[2])
    year = Number(dayFirst[3])
    if (second > 12 && first <= 12) {
      month = first
      day = second
    } else {
      day = first
      month = second
    }
  }

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    year < 2000 ||
    year > 2200 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function classifyState(value: string): 'completed' | 'pending' | 'rejected' {
  const state = normalizeText(value)
  if (
    ['completed', 'complete', 'booked', 'execute', 'effectue'].includes(state)
  ) {
    return 'completed'
  }
  if (state === 'pending' || state === 'en attente') return 'pending'
  return 'rejected'
}

function inferKind(
  amountCents: number,
  transactionType: string | null,
): ImportedTransactionKind {
  if (amountCents > 0) return 'income'
  const type = normalizeText(transactionType ?? '')
  if (
    type.includes('exchange') ||
    type.includes('top up') ||
    type.includes('topup') ||
    type.includes('transfer') ||
    type.includes('virement')
  ) {
    return 'transfer'
  }
  return 'expense'
}

function stableHash(value: string): string {
  let first = 0xdeadbeef
  let second = 0x41c6ce57
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^
    Math.imul(second ^ (second >>> 13), 3266489909)
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^
    Math.imul(first ^ (first >>> 13), 3266489909)
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(
    second >>> 0
  )
    .toString(16)
    .padStart(8, '0')}`
}

function makeSourceKey(values: {
  sourceReference: string | null
  startedAt: string | null
  completedAt: string | null
  description: string
  amountCents: number
  feeCents: number
  balanceCents: number | null
  currency: string
  transactionType: string | null
  product: string | null
}) {
  const canonical = [
    values.sourceReference,
    values.startedAt,
    values.completedAt,
    normalizeText(values.description),
    values.amountCents,
    values.feeCents,
    values.balanceCents,
    values.currency,
    normalizeText(values.transactionType ?? ''),
    normalizeText(values.product ?? ''),
  ].join('\u001f')
  return `revolut-${stableHash(canonical)}`
}

export function parseRevolutCsv(
  text: string,
  options: ParseOptions,
): RevolutCsvResult {
  if (text.trim() === '') {
    throw new RevolutCsvError('The CSV file is empty.')
  }

  const delimiter = detectDelimiter(text)
  const records = parseRecords(text, delimiter)
  if (records.length < 2) {
    throw new RevolutCsvError('The file does not contain any transactions.')
  }

  const headers = resolveHeaders(records[0]!.values)
  const importedAt = options.importedAt ?? new Date().toISOString()
  const idFactory = options.idFactory ?? (() => crypto.randomUUID())
  const importBatchId = idFactory()
  const sourceFileName =
    options.fileName.trim().slice(0, 255) || 'revolut.csv'
  const transactions: ImportedTransaction[] = []
  const issues: RevolutCsvIssue[] = []
  const sourceKeys = new Set<string>()

  for (const record of records.slice(1)) {
    try {
      const state = classifyState(cell(record, headers, 'state'))
      if (state === 'pending') {
        issues.push({
          line: record.line,
          reason: 'pending',
          message: 'Pending transaction. Import it again once it is completed.',
        })
        continue
      }
      if (state === 'rejected') {
        issues.push({
          line: record.line,
          reason: 'rejected',
          message: 'Transaction cancelled, rejected, or in an unsupported state.',
        })
        continue
      }

      const description = cell(record, headers, 'description')
      if (!description) throw new Error('missing description')
      const amountCents = parseCents(
        cell(record, headers, 'amount'),
        'amount',
      )
      if (amountCents === 0) throw new Error('zero amount')
      const currency = cell(record, headers, 'currency').toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new Error(`invalid currency: “${currency}”`)
      }

      const startedAt =
        cell(record, headers, 'startedAt').slice(0, 100) || null
      const completedAt =
        cell(record, headers, 'completedAt').slice(0, 100) || null
      const bookingDate = toIsoDate(completedAt ?? startedAt ?? '')
      if (!bookingDate) throw new Error('missing or invalid date')

      const feeCents =
        parseOptionalCents(cell(record, headers, 'fee'), 'fee') ?? 0
      if (feeCents < 0) throw new Error('fees cannot be negative')
      const balanceCents = parseOptionalCents(
        cell(record, headers, 'balance'),
        'balance',
      )
      const transactionType = cell(record, headers, 'type') || null
      const product = cell(record, headers, 'product') || null
      const sourceReference =
        cell(record, headers, 'reference').slice(0, 200) || null
      const sourceKey = makeSourceKey({
        sourceReference,
        startedAt,
        completedAt,
        description,
        amountCents,
        feeCents,
        balanceCents,
        currency,
        transactionType,
        product,
      })

      if (sourceKeys.has(sourceKey)) {
        issues.push({
          line: record.line,
          reason: 'duplicate',
          message: 'Duplicate transaction in this file.',
        })
        continue
      }
      sourceKeys.add(sourceKey)

      transactions.push({
        id: idFactory(),
        provider: 'revolut-csv',
        sourceKey,
        sourceReference,
        importBatchId,
        sourceFileName,
        bookingDate,
        startedAt,
        completedAt,
        description: description.slice(0, 500),
        amountCents,
        feeCents,
        balanceCents,
        currency,
        transactionType: transactionType?.slice(0, 100) ?? null,
        product: product?.slice(0, 100) ?? null,
        kind: inferKind(amountCents, transactionType),
        categoryId: null,
        importedAt,
      })
    } catch (error) {
      issues.push({
        line: record.line,
        reason: 'invalid',
        message:
          error instanceof Error ? error.message : 'Invalid CSV row.',
      })
    }
  }

  return {
    delimiter,
    rowCount: records.length - 1,
    transactions,
    issues,
  }
}
