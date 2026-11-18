import { describe, expect, it } from 'vitest'
import { validateMonthSearch } from './month-search'

describe('validateMonthSearch', () => {
  it('keeps a valid month key', () => {
    expect(validateMonthSearch({ m: '2026-08' })).toEqual({ m: '2026-08' })
  })

  it('drops malformed values', () => {
    for (const m of ['2026-13', '2026-00', '26-08', 'abc', 2026, null]) {
      expect(validateMonthSearch({ m })).toEqual({})
    }
    expect(validateMonthSearch({})).toEqual({})
  })

  it('drops years the stored schema rejects', () => {
    expect(validateMonthSearch({ m: '1999-12' })).toEqual({})
    expect(validateMonthSearch({ m: '0001-05' })).toEqual({})
    expect(validateMonthSearch({ m: '2201-01' })).toEqual({})
    expect(validateMonthSearch({ m: '2000-01' })).toEqual({ m: '2000-01' })
    expect(validateMonthSearch({ m: '2200-12' })).toEqual({ m: '2200-12' })
  })
})
