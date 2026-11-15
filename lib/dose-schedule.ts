import type { DbClient, DbStatement } from './db'
import { addDays, differenceInCalendarDays, isValid, parseISO, startOfDay } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'

/** Keep a rolling 30-day window of scheduled doses for a patient's active medications. */
export async function ensureDoseSchedule(db: DbClient, patientId: string) {
  const result = await db.execute({ sql: 'SELECT id,start_date,end_date,frequency,times FROM medications WHERE patient_id=? AND active=1', args: [patientId] })
  const today = startOfDay(new Date()), horizon = addDays(today, 29)
  const statements: DbStatement[] = []

  for (const medication of result.rows) {
    if (medication.frequency === 'As needed') continue
    const startDate = parseISO(String(medication.start_date))
    if (!isValid(startDate)) continue
    const firstDay = startOfDay(startDate > today ? startDate : today)
    const medicationEnd = medication.end_date ? parseISO(String(medication.end_date)) : null
    if (medicationEnd && (!isValid(medicationEnd) || medicationEnd < firstDay)) continue
    let times: unknown
    try { times = JSON.parse(String(medication.times)) } catch { continue }
    if (!Array.isArray(times)) continue

    for (let day = firstDay; day <= horizon && (!medicationEnd || day <= medicationEnd); day = addDays(day, 1)) {
      if (medication.frequency === 'Weekly' && differenceInCalendarDays(day, startOfDay(startDate)) % 7 !== 0) continue
      for (const value of times) {
        if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) continue
        const [hours, minutes] = value.split(':').map(Number)
        const scheduled = new Date(day); scheduled.setHours(hours, minutes, 0, 0)
        statements.push({
          sql: `INSERT INTO dose_logs (id,medication_id,patient_id,scheduled_time,status) VALUES (?,?,?,?,'pending') ON CONFLICT (medication_id,scheduled_time) DO NOTHING`,
          args: [uuidv4(), String(medication.id), patientId, scheduled.toISOString()],
        })
      }
    }
  }

  if (statements.length) await db.batch(statements)
}
