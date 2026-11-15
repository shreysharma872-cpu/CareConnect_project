import { NextRequest, NextResponse } from 'next/server'
import { getDb, toObj } from '@/lib/db'
import { verifyPasscode } from '@/lib/auth'
import { createSessionToken, sessionCookieOptions } from '@/lib/session'

export async function POST(request: NextRequest) {
  try {
    const db = await getDb()
    const { patientId, passcode } = await request.json()
    if (!patientId || !passcode) return NextResponse.json({ error: 'ID and passcode required' }, { status: 400 })

    const res = await db.execute({ sql: 'SELECT * FROM patients WHERE id = ?', args: [patientId.toUpperCase()] })
    const patient = toObj(res.rows[0])
    if (!patient) return NextResponse.json({ error: 'Invalid patient ID or passcode' }, { status: 401 })

    const valid = await verifyPasscode(passcode, patient.passcode)
    if (!valid) return NextResponse.json({ error: 'Invalid patient ID or passcode' }, { status: 401 })

    const { passcode: _, ...safe } = patient
    const response = NextResponse.json({ success: true, patient: safe })
    response.cookies.set('careconnect_session', createSessionToken(patient.id), sessionCookieOptions())
    return response
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
