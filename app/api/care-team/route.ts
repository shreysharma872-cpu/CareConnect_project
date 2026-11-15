import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '@/lib/db'
import { getSessionPatientId } from '@/lib/session'

export async function GET(request: NextRequest) {
  const patientId = new URL(request.url).searchParams.get('patientId')
  const sessionId = getSessionPatientId(request)
  if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!patientId || patientId !== sessionId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const db = await getDb()
    const result = await db.execute({ sql: 'SELECT id,name,email,role,created_at FROM authorized_users WHERE patient_id=? ORDER BY created_at ASC', args: [sessionId] })
    return NextResponse.json(result.rows)
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  const sessionId = getSessionPatientId(request)
  if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  try {
    const db = await getDb(), { name, email, role = 'family' } = await request.json()
    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['family', 'caretaker', 'admin'].includes(role))
      return NextResponse.json({ error: 'Enter a name, valid email, and role' }, { status: 400 })
    const normalizedEmail = email.trim().toLowerCase()
    const existing = await db.execute({ sql: 'SELECT id FROM authorized_users WHERE patient_id=? AND lower(email)=?', args: [sessionId, normalizedEmail] })
    if (existing.rows.length) return NextResponse.json({ error: 'This email is already on the care team' }, { status: 409 })
    const id = uuidv4()
    await db.execute({ sql: 'INSERT INTO authorized_users (id,patient_id,name,email,role) VALUES (?,?,?,?,?)', args: [id, sessionId, name.trim(), normalizedEmail, role] })
    return NextResponse.json({ id, message: 'Care team member added' }, { status: 201 })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

export async function DELETE(request: NextRequest) {
  const sessionId = getSessionPatientId(request)
  if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })
  try {
    const db = await getDb()
    await db.execute({ sql: 'DELETE FROM authorized_users WHERE id=? AND patient_id=?', args: [id, sessionId] })
    return NextResponse.json({ message: 'Care team member removed' })
  } catch (error) { console.error(error); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
