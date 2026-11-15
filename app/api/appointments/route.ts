import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '@/lib/db'
import { getSessionPatientId } from '@/lib/session'

export async function GET(request: NextRequest) {
  try {
    const db = await getDb(); const { searchParams } = new URL(request.url), patientId = searchParams.get('patientId')
    if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 })
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const upcoming = searchParams.get('upcoming') === 'true'
    const result = await db.execute({ sql: `SELECT * FROM appointments WHERE patient_id=?${upcoming ? " AND appointment_datetime>=? AND status='scheduled'" : ''} ORDER BY appointment_datetime ASC`, args: upcoming ? [patientId, new Date().toISOString()] : [patientId] })
    return NextResponse.json(result.rows)
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  try {
    const db = await getDb(); const body = await request.json()
    const { patient_id, doctor_name, specialty, appointment_datetime, location, notes } = body
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patient_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!patient_id || !doctor_name?.trim() || !appointment_datetime || !Number.isFinite(Date.parse(appointment_datetime))) return NextResponse.json({ error: 'Valid patient, doctor and appointment time are required' }, { status: 400 })
    const id = uuidv4()
    await db.execute({ sql: 'INSERT INTO appointments (id,patient_id,doctor_name,specialty,appointment_datetime,location,notes) VALUES (?,?,?,?,?,?,?)', args: [id, patient_id, doctor_name.trim(), specialty || null, new Date(appointment_datetime).toISOString(), location || null, notes || null] })
    return NextResponse.json({ id, message: 'Appointment scheduled' }, { status: 201 })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function PUT(request: NextRequest) {
  try {
    const db = await getDb(); const body = await request.json()
    const { id, doctor_name, specialty, appointment_datetime, location, notes, status } = body
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (!id || !doctor_name || !appointment_datetime || !['scheduled', 'completed', 'cancelled'].includes(status || 'scheduled')) return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
    await db.execute({ sql: 'UPDATE appointments SET doctor_name=?,specialty=?,appointment_datetime=?,location=?,notes=?,status=? WHERE id=? AND patient_id=?', args: [doctor_name, specialty || null, new Date(appointment_datetime).toISOString(), location || null, notes || null, status || 'scheduled', id, sessionId] })
    return NextResponse.json({ message: 'Updated' })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = await getDb(); const id = new URL(request.url).searchParams.get('id')
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })
    await db.execute({ sql: "UPDATE appointments SET status='cancelled' WHERE id=? AND patient_id=?", args: [id, sessionId] })
    return NextResponse.json({ message: 'Cancelled' })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
