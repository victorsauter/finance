import { describe, expect, it } from 'vitest'
import {
  parseRevolutCsv,
  RevolutCsvError,
} from './revolut-csv'

function createIds() {
  let sequence = 0
  return () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`
}

describe('parseRevolutCsv', () => {
  it('parses a Revolut export and classifies completed operations', () => {
    const csv = [
      'Started Date,Completed Date,Description,Amount,Fee,Type,Product,State,Currency,Balance,Reference',
      '2026-09-01,2026-09-02,"Marché, centre",-12.34,0,card payment,Current,COMPLETED,EUR,900.50,card-1',
      '2026-09-03,2026-09-03,Salary,2500,0,bank transfer,Current,COMPLETED,EUR,3400.50,salary-1',
      '2026-09-04,2026-09-04,Savings,-500,0,bank transfer,Current,COMPLETED,EUR,2900.50,transfer-1',
    ].join('\n')

    const result = parseRevolutCsv(csv, {
      fileName: 'statement.csv',
      importedAt: '2026-09-30T08:00:00.000Z',
      idFactory: createIds(),
    })

    expect(result.rowCount).toBe(3)
    expect(result.issues).toEqual([])
    expect(result.transactions).toHaveLength(3)
    expect(result.transactions[0]).toMatchObject({
      description: 'Marché, centre',
      amountCents: -1234,
      balanceCents: 90050,
      bookingDate: '2026-09-02',
      kind: 'expense',
      sourceReference: 'card-1',
    })
    expect(result.transactions[1]!.kind).toBe('income')
    expect(result.transactions[2]!.kind).toBe('transfer')
  })

  it('supports semicolon-delimited localized headers and decimal commas', () => {
    const csv = [
      'Date de début;Date de fin;Libellé;Montant;Frais;Type;Produit;État;Devise',
      '29/09/2026;30/09/2026;"Café ""Central""";-4,75;0;Paiement carte;Courant;Effectué;EUR',
    ].join('\r\n')

    const result = parseRevolutCsv(csv, {
      fileName: 'revolut-septembre.csv',
      idFactory: createIds(),
    })

    expect(result.delimiter).toBe(';')
    expect(result.transactions[0]).toMatchObject({
      description: 'Café "Central"',
      amountCents: -475,
      bookingDate: '2026-09-30',
      currency: 'EUR',
    })
  })

  it('skips pending, rejected, malformed, and duplicate rows with reasons', () => {
    const csv = [
      'Started Date,Completed Date,Description,Amount,Type,State,Currency,Reference',
      '2026-09-01,,Coffee,-3.50,card payment,PENDING,EUR,pending-1',
      '2026-09-01,2026-09-01,Coffee,-3.50,card payment,REVERTED,EUR,reverted-1',
      'not-a-date,not-a-date,Coffee,-3.50,card payment,COMPLETED,EUR,bad-1',
      '2026-09-02,2026-09-02,Groceries,-25,card payment,COMPLETED,EUR,good-1',
      '2026-09-02,2026-09-02,Groceries,-25,card payment,COMPLETED,EUR,good-1',
    ].join('\n')

    const result = parseRevolutCsv(csv, {
      fileName: 'statement.csv',
      idFactory: createIds(),
    })

    expect(result.transactions).toHaveLength(1)
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      'pending',
      'rejected',
      'invalid',
      'duplicate',
    ])
  })

  it('rejects files without the required Revolut columns', () => {
    expect(() =>
      parseRevolutCsv('Date,Label,Value\n2026-09-01,Coffee,-3', {
        fileName: 'unknown.csv',
      }),
    ).toThrow(RevolutCsvError)
    expect(() =>
      parseRevolutCsv('Date,Label,Value\n2026-09-01,Coffee,-3', {
        fileName: 'unknown.csv',
      }),
    ).toThrow('Colonnes Revolut manquantes')
  })
})
