import { describe, expect, it } from 'vitest'
import { parseAppData } from './schema'

// `fixtures/sync/app-data.swift.json` is what the iPhone app (FinanceKit)
// writes after decoding `fixtures/domain/app-data.json`. The Swift test
// `RoundTripTests` keeps it current; this side checks the web accepts it
// unchanged, so a document synced from the iPhone loses nothing.

const load = (glob: Record<string, unknown>) => Object.values(glob)[0]
const web = load(import.meta.glob('../../../fixtures/domain/app-data.json', {
  eager: true, import: 'default',
})) as { appData: unknown }
const swift = load(import.meta.glob('../../../fixtures/sync/app-data.swift.json', {
  eager: true, import: 'default',
}))

describe('Swift round trip', () => {
  it('finds both documents', () => {
    expect(web?.appData).toBeDefined()
    expect(swift).toBeDefined()
  })

  it('writes exactly the document the web wrote', () => {
    expect(swift).toEqual(web.appData)
  })

  it('is accepted by the web schema without changes', () => {
    expect(parseAppData(swift)).toEqual(web.appData)
  })
})
