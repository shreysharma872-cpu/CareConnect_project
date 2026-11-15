import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionPatientId } from '@/lib/session'
import { ensureDoseSchedule } from '@/lib/dose-schedule'

export async function GET(request: NextRequest) {
  try {
    const db = await getDb(); const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId'), date = searchParams.get('date'), medicationId = searchParams.get('medicationId')
    if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 })
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await ensureDoseSchedule(db, patientId)
    if (date) {
      const start = new Date(`${date}T00:00:00`).toISOString(), end = new Date(`${date}T23:59:59.999`).toISOString()
      const result = await db.execute({ sql: `SELECT dl.*,m.name AS medication_name,m.dosage,m.dosage_unit,m.color,m.with_food,m.times FROM dose_logs dl JOIN medications m ON dl.medication_id=m.id WHERE dl.patient_id=? AND dl.scheduled_time>=? AND dl.scheduled_time<=? AND m.active=1 ORDER BY dl.scheduled_time ASC`, args: [patientId, start, end] })
      return NextResponse.json(result.rows)
    }
    const result = await db.execute({ sql: `SELECT dl.*,m.name AS medication_name,m.dosage,m.dosage_unit,m.color FROM dose_logs dl JOIN medications m ON dl.medication_id=m.id WHERE dl.patient_id=?${medicationId ? ' AND dl.medication_id=?' : ''} ORDER BY dl.scheduled_time DESC LIMIT 100`, args: medicationId ? [patientId, medicationId] : [patientId] })
    return NextResponse.json(result.rows)
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  try {
    const db = await getDb(); const { doseId, status, notes } = await request.json()
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (!doseId || !['taken', 'missed', 'pending'].includes(status)) return NextResponse.json({ error: 'Valid doseId and status required' }, { status: 400 })
    await db.execute({ sql: 'UPDATE dose_logs SET status=?,taken_at=?,notes=? WHERE id=? AND patient_id=?', args: [status, status === 'taken' ? new Date().toISOString() : null, notes || null, doseId, sessionId] })
    return NextResponse.json({ message: 'Updated' })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
