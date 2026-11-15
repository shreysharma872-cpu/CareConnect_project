import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '@/lib/db'
import { parseISO, isValid } from 'date-fns'
import { getSessionPatientId } from '@/lib/session'
import { ensureDoseSchedule } from '@/lib/dose-schedule'

const validFrequencies = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Weekly', 'As needed']

export async function GET(request: NextRequest) {
  try {
    const db = await getDb()
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')
    if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 })
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const activeOnly = searchParams.get('active') === 'true'
    const result = await db.execute({ sql: `SELECT * FROM medications WHERE patient_id = ?${activeOnly ? ' AND active = 1' : ''} ORDER BY created_at DESC`, args: [patientId] })
    return NextResponse.json(result.rows)
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  try {
    const db = await getDb()
    const body = await request.json()
    const { patient_id, name, dosage, dosage_unit = 'mg', frequency, times, with_food, start_date, end_date, notes, color = '#14b8a6' } = body
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patient_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!patient_id || !name?.trim() || !Number.isFinite(Number(dosage)) || Number(dosage) <= 0 || !validFrequencies.includes(frequency) || !Array.isArray(times) || !times.length || !start_date)
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    if (!times.every((time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return NextResponse.json({ error: 'Invalid dose time' }, { status: 400 })
    const start = parseISO(start_date)
    const end = end_date ? parseISO(end_date) : null
    if (!isValid(start) || (end && (!isValid(end) || end < start))) return NextResponse.json({ error: 'Invalid medication date range' }, { status: 400 })
    const id = uuidv4(), timesJson = JSON.stringify(times), safeColor = /^#[\da-f]{6}$/i.test(color) ? color : '#14b8a6'
    await db.execute({ sql: `INSERT INTO medications (id,patient_id,name,dosage,dosage_unit,frequency,times,with_food,start_date,end_date,notes,color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, args: [id, patient_id, name.trim(), dosage, dosage_unit, frequency, timesJson, with_food ? 1 : 0, start_date, end_date || null, notes || null, safeColor] })
    await ensureDoseSchedule(db, patient_id)
    return NextResponse.json({ id, message: 'Medication added' }, { status: 201 })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function PUT(request: NextRequest) {
  try {
    const db = await getDb(); const body = await request.json()
    const { id, name, dosage, dosage_unit, frequency, times, with_food, start_date, end_date, notes, color, active } = body
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (!id || typeof name !== 'string' || !name.trim() || !Number.isFinite(Number(dosage)) || Number(dosage) <= 0 || !validFrequencies.includes(frequency) || !Array.isArray(times) || !times.length || !times.every((time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || !start_date) return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
    const owner = await db.execute({ sql: 'SELECT patient_id FROM medications WHERE id=?', args: [id] })
    if (owner.rows[0]?.patient_id !== sessionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.execute({ sql: "DELETE FROM dose_logs WHERE medication_id=? AND patient_id=? AND status='pending' AND scheduled_time>=?", args: [id, sessionId, new Date().toISOString()] })
    const safeColor = typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : '#14b8a6'
    await db.execute({ sql: `UPDATE medications SET name=?,dosage=?,dosage_unit=?,frequency=?,times=?,with_food=?,start_date=?,end_date=?,notes=?,color=?,active=? WHERE id=? AND patient_id=?`, args: [name.trim(), dosage, dosage_unit || 'mg', frequency, JSON.stringify(times), with_food ? 1 : 0, start_date, end_date || null, notes || null, safeColor, active === false || active === 0 ? 0 : 1, id, sessionId] })
    if (active !== false && active !== 0) await ensureDoseSchedule(db, sessionId)
    return NextResponse.json({ message: 'Updated' })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = await getDb(); const id = new URL(request.url).searchParams.get('id')
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })
    await db.execute({ sql: 'UPDATE medications SET active = 0 WHERE id = ? AND patient_id = ?', args: [id, sessionId] })
    return NextResponse.json({ message: 'Deactivated' })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
