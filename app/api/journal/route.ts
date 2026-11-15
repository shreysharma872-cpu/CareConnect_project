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
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '30', 10) || 30))
    const result = await db.execute({ sql: 'SELECT * FROM journal_entries WHERE patient_id=? ORDER BY created_at DESC LIMIT ?', args: [patientId, limit] })
    return NextResponse.json(result.rows)
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  try {
    const db = await getDb(); const { patient_id, mood, energy_level, symptoms, notes } = await request.json()
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patient_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!patient_id || !Number.isInteger(Number(mood)) || Number(mood) < 1 || Number(mood) > 5) return NextResponse.json({ error: 'Mood must be between 1 and 5' }, { status: 400 })
    const id = uuidv4()
    await db.execute({ sql: 'INSERT INTO journal_entries (id,patient_id,mood,energy_level,symptoms,notes) VALUES (?,?,?,?,?,?)', args: [id, patient_id, Number(mood), energy_level ?? null, symptoms || null, notes || null] })
    return NextResponse.json({ id, message: 'Entry saved' }, { status: 201 })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
