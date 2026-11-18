// Throwaway entry used only to measure what a production Vite build of
// @powersync/web ships. It opens a database with the Finance schema and
// connects, so the sync client, the database worker and the WASM are all kept.
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/web'

const schema = new Schema({
  budget_months: new Table({ owner_id: column.text, year: column.integer, month: column.integer, name: column.text }),
})

const db = new PowerSyncDatabase({ schema, database: { dbFilename: 'finance.db', vfs: 'auto' } })

await db.connect({
  fetchCredentials: async () => ({ endpoint: 'http://127.0.0.1:8080', token: 'unused' }),
  uploadData: async (database) => {
    const transaction = await database.getNextCrudTransaction()
    await transaction?.complete()
  },
})
document.body.textContent = String((await db.getAll('select * from budget_months')).length)
