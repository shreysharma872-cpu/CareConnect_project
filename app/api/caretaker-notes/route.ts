import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '@/lib/db'
import { getSessionPatientId } from '@/lib/session'

export async function GET(request: NextRequest) {
  try {
    const db = await getDb(), patientId = new URL(request.url).searchParams.get('patientId')
    if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 })
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const result = await db.execute({ sql: 'SELECT * FROM caretaker_notes WHERE patient_id=? ORDER BY created_at DESC LIMIT 50', args: [patientId] })
    return NextResponse.json(result.rows)
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  try {
    const db = await getDb(); const { patient_id, author_name, content, is_important } = await request.json()
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (sessionId !== patient_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!patient_id || !author_name?.trim() || !content?.trim()) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const id = uuidv4()
    await db.execute({ sql: 'INSERT INTO caretaker_notes (id,patient_id,author_name,content,is_important) VALUES (?,?,?,?,?)', args: [id, patient_id, author_name.trim(), content.trim(), is_important ? 1 : 0] })
    return NextResponse.json({ id, message: 'Note added' }, { status: 201 })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
