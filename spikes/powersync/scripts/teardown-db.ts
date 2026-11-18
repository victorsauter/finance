// Removes everything scripts/setup-db.ts created in the LOCAL database, plus the
// replication slots PowerSync created. Run after `npm run down` (an active slot
// cannot be dropped).
//
// Usage: npm run teardown-db [-- <postgres connection string>]
import pg from 'pg'
import { assertLocal, localSupabase } from '../src/env.ts'

async function main() {
  const dbUrl = process.argv[2] ?? localSupabase().dbUrl
  assertLocal(dbUrl, 'the database')
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  try {
    const slots = await client.query<{ slot_name: string; active: boolean }>(
      "select slot_name, active from pg_replication_slots where slot_name like 'powersync%'",
    )
    for (const slot of slots.rows) {
      if (slot.active) throw new Error(`Slot ${slot.slot_name} is still active: stop the PowerSync container first.`)
      await client.query('select pg_drop_replication_slot($1)', [slot.slot_name])
      console.log(`Dropped replication slot ${slot.slot_name}`)
    }
    await client.query('drop publication if exists powersync')
    await client.query('drop database if exists powersync_storage with (force)')
    for (const role of ['powersync_role', 'powersync_storage_user']) {
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [role])
      if (!exists.rowCount) continue
      // postgres is not a superuser on Supabase: it must be a member to drop what the role owns.
      await client.query(`grant ${role} to postgres`)
      await client.query(`drop owned by ${role}`)
      await client.query(`drop role ${role}`)
    }
    console.log('Removed publication powersync, database powersync_storage, roles powersync_role and powersync_storage_user.')
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
