import { createClient } from '@libsql/client'
import pg from 'pg'
import { resolve } from 'node:path'

const { Client } = pg
const tables = [
  'patients',
  'authorized_users',
  'medications',
  'dose_logs',
  'appointments',
  'vitals',
  'journal_entries',
  'caretaker_notes',
]

const sqlitePath = resolve(process.env.SQLITE_PATH || 'elderly_care.db').replaceAll('\\', '/')
const sqliteUrl = process.env.SQLITE_URL || `file:${sqlitePath}`
const databaseUrl = process.env.POSTGRES_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('Set POSTGRES_DATABASE_URL or DATABASE_URL to the PostgreSQL connection string.')
  process.exit(1)
}

const source = createClient({ url: sqliteUrl })
const target = new Client({ connectionString: databaseUrl })

try {
  await target.connect()
  console.log(`Copying CareConnect records from ${sqliteUrl} to PostgreSQL.`)
  await target.query('BEGIN')

  for (const table of tables) {
    const sourceColumnsResult = await source.execute(`PRAGMA table_info("${table}")`)
    const sourceColumns = sourceColumnsResult.rows.map(row => String(row.name))
    if (!sourceColumns.length) {
      console.log(`  ${table}: source table not found; skipped`)
      continue
    }

    const targetColumnsResult = await target.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position',
      [table],
    )
    const targetColumns = new Set(targetColumnsResult.rows.map(row => row.column_name))
    const columns = sourceColumns.filter(column => targetColumns.has(column))
    if (!columns.includes('id')) throw new Error(`Table ${table} has no shared id column.`)

    const rows = await source.execute(`SELECT * FROM "${table}"`)
    let copied = 0
    const namesSql = columns.map(column => `"${column}"`).join(',')
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(',')
    const insert = `INSERT INTO "${table}" (${namesSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`

    for (const row of rows.rows) {
      const values = columns.map(column => row[column] ?? null)
      const result = await target.query(insert, values)
      copied += result.rowCount || 0
    }
    console.log(`  ${table}: ${copied} rows copied`)
  }

  await target.query('COMMIT')
  console.log('Migration complete. Existing PostgreSQL rows were preserved; duplicate IDs were skipped.')
} catch (error) {
  await target.query('ROLLBACK').catch(() => {})
  console.error('Migration failed; PostgreSQL changes were rolled back.')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  source.close()
  await target.end().catch(() => {})
}
