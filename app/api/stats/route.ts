import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { subDays, format } from 'date-fns'
import { getSessionPatientId } from '@/lib/session'

export async function GET(request: NextRequest) {
  try {
    const db = await getDb(); const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId'), requestedDays = Number(searchParams.get('days') || 30)
    if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 })
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const days = Math.min(365, Math.max(1, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : 30))
    const since = subDays(new Date(), days).toISOString()
    const [total, taken, missed, appointments, meds] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) AS count FROM dose_logs WHERE patient_id=? AND scheduled_time>=? AND scheduled_time<=?`, args: [patientId, since, new Date().toISOString()] }),
      db.execute({ sql: `SELECT COUNT(*) AS count FROM dose_logs WHERE patient_id=? AND status='taken' AND scheduled_time>=? AND scheduled_time<=?`, args: [patientId, since, new Date().toISOString()] }),
      db.execute({ sql: `SELECT COUNT(*) AS count FROM dose_logs WHERE patient_id=? AND status='missed' AND scheduled_time>=? AND scheduled_time<=?`, args: [patientId, since, new Date().toISOString()] }),
      db.execute({ sql: `SELECT COUNT(*) AS count FROM appointments WHERE patient_id=? AND appointment_datetime>=? AND status='scheduled'`, args: [patientId, new Date().toISOString()] }),
      db.execute({ sql: `SELECT COUNT(*) AS count FROM medications WHERE patient_id=? AND active=1`, args: [patientId] }),
    ])
    const count = (result: typeof total) => Number(result.rows[0]?.count || 0)
    const totalDoses = count(total), takenDoses = count(taken)
    const dailyStats = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
      const offset = 6 - index, day = subDays(new Date(), offset), start = new Date(day); start.setHours(0, 0, 0, 0)
      const end = new Date(day); end.setHours(23, 59, 59, 999)
      const [dayTotal, dayTaken] = await Promise.all([
        db.execute({ sql: 'SELECT COUNT(*) AS count FROM dose_logs WHERE patient_id=? AND scheduled_time>=? AND scheduled_time<=?', args: [patientId, start.toISOString(), end.toISOString()] }),
        db.execute({ sql: `SELECT COUNT(*) AS count FROM dose_logs WHERE patient_id=? AND status='taken' AND scheduled_time>=? AND scheduled_time<=?`, args: [patientId, start.toISOString(), end.toISOString()] }),
      ])
      const doses = Number(dayTotal.rows[0]?.count || 0), done = Number(dayTaken.rows[0]?.count || 0)
      return { date: format(day, 'EEE'), total: doses, taken: done, rate: doses ? Math.round(done / doses * 100) : 0 }
    }))
    return NextResponse.json({ adherenceRate: totalDoses ? Math.round(takenDoses / totalDoses * 100) : 0, totalDoses, takenDoses, missedDoses: count(missed), upcomingAppointments: count(appointments), activeMedications: count(meds), dailyStats })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
