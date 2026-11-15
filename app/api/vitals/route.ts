import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '@/lib/db'
import { getSessionPatientId } from '@/lib/session'

export async function GET(request: NextRequest) {
  try {
    const db = await getDb(); const { searchParams } = new URL(request.url), patientId = searchParams.get('patientId'), type = searchParams.get('type')
    if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 })
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '30', 10) || 30))
    const result = await db.execute({ sql: `SELECT * FROM vitals WHERE patient_id=?${type ? ' AND type=?' : ''} ORDER BY recorded_at DESC LIMIT ?`, args: type ? [patientId, type, limit] : [patientId, limit] })
    return NextResponse.json(result.rows)
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  try {
    const db = await getDb(); const { patient_id, type, value, unit, notes } = await request.json()
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patient_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!patient_id || !type || !Number.isFinite(Number(value)) || !unit) return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
    const id = uuidv4()
    await db.execute({ sql: 'INSERT INTO vitals (id,patient_id,type,value,unit,notes) VALUES (?,?,?,?,?,?)', args: [id, patient_id, type, Number(value), unit, notes || null] })
    return NextResponse.json({ id, message: 'Vital recorded' }, { status: 201 })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
