import { describe, expect, it } from 'vitest'
import { formatMoney, MAX_AMOUNT_CENTS, parseMoneyInput } from './money'

describe('money helpers', () => {
  it('parses French decimal input into integer cents', () => {
    expect(parseMoneyInput('1 234,56')).toBe(123456)
    expect(parseMoneyInput('42')).toBe(4200)
    expect(parseMoneyInput('')).toBe(0)
  })

  it('rejects negative values and excess decimal places', () => {
    expect(parseMoneyInput('-1')).toBeNull()
    expect(parseMoneyInput('12,345')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
  })

  it('rejects amounts above the cap that would break saving', () => {
    expect(parseMoneyInput('1000000000')).toBe(MAX_AMOUNT_CENTS)
    expect(parseMoneyInput('1000000000.01')).toBeNull()
    expect(parseMoneyInput('99999999999999999999')).toBeNull()
  })

  it('formats euros using English conventions', () => {
    expect(formatMoney(123456)).toContain('1,234.56')
    expect(formatMoney(123456)).toContain('€')
  })
})
