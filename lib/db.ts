import { createClient, type Client } from '@libsql/client'
import path from 'path'

let client: Client | null = null
let initialization: Promise<Client> | null = null

export async function getDb(): Promise<Client> {
  if (!initialization) {
    const dbPath = process.env.DATABASE_PATH || './elderly_care.db'
    // @libsql/client needs an absolute path on Windows for file: URLs
    const absPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath)
    const url = `file:${absPath.replace(/\\/g, '/')}`
    client = createClient({ url })
    initialization = initDb(client).then(() => client as Client).catch(error => {
      client?.close()
      client = null
      initialization = null
      throw error
    })
  }
  return initialization
}

export default getDb

async function initDb(db: Client) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dob TEXT,
      blood_group TEXT,
      passcode TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      emergency_contact_relation TEXT,
      allergies TEXT,
      medical_conditions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS authorized_users (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'family',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS medications (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      dosage_unit TEXT DEFAULT 'mg',
      frequency TEXT NOT NULL,
      times TEXT NOT NULL,
      with_food INTEGER DEFAULT 0,
      start_date TEXT NOT NULL,
      end_date TEXT,
      notes TEXT,
      color TEXT DEFAULT '#14b8a6',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS dose_logs (
      id TEXT PRIMARY KEY,
      medication_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      scheduled_time DATETIME NOT NULL,
      taken_at DATETIME,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      reminder_sent INTEGER DEFAULT 0,
      missed_reminder_sent INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      specialty TEXT,
      appointment_datetime DATETIME NOT NULL,
      location TEXT,
      notes TEXT,
      status TEXT DEFAULT 'scheduled',
      reminder_24h_sent INTEGER DEFAULT 0,
      reminder_1h_sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS vitals (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      notes TEXT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      mood INTEGER NOT NULL,
      energy_level INTEGER,
      symptoms TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS caretaker_notes (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_important INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  ]

  await db.batch(tables.map(sql => ({ sql, args: [] })), 'write')
  const doseColumns = await db.execute('PRAGMA table_info(dose_logs)')
  if (!doseColumns.rows.some(column => column.name === 'missed_reminder_sent')) {
    await db.execute('ALTER TABLE dose_logs ADD COLUMN missed_reminder_sent INTEGER DEFAULT 0')
    await db.execute("UPDATE dose_logs SET missed_reminder_sent=reminder_sent WHERE status='missed'")
  }
  await db.execute('DELETE FROM dose_logs WHERE rowid NOT IN (SELECT MIN(rowid) FROM dose_logs GROUP BY medication_id, scheduled_time)')
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_dose_medication_schedule ON dose_logs (medication_id, scheduled_time)')
}

/** Convert a libsql Row to a plain JS object */
export function toObj(row: any): any {
  if (!row) return null
  const obj: Record<string, any> = {}
  for (const key of Object.keys(row)) {
    obj[key] = row[key]
  }
  return obj
}

/** Convert an array of libsql Rows to plain objects */
export function toObjs(rows: any[]): any[] {
  return rows.map(toObj)
}
