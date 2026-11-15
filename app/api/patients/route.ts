import { NextRequest, NextResponse } from 'next/server'
import { getDb, toObj } from '@/lib/db'
import { hashPasscode, generatePatientId } from '@/lib/auth'
import { getSessionPatientId } from '@/lib/session'

export async function GET(request: NextRequest) {
  try {
    const db = await getDb()
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('id')
    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (!patientId || patientId !== sessionId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const res = await db.execute({ sql: 'SELECT * FROM patients WHERE id = ?', args: [patientId] })
    const patient = toObj(res.rows[0])
    if (!patient) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { passcode: _, ...safe } = patient
    return NextResponse.json(safe)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = await getDb()
    const body = await request.json()
    const { name, dob, blood_group, passcode, email, phone, address,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
      allergies, medical_conditions } = body

    if (typeof name !== 'string' || !name.trim() || typeof passcode !== 'string' || passcode.length < 4 || passcode.length > 128)
      return NextResponse.json({ error: 'Enter a name and a passcode between 4 and 128 characters' }, { status: 400 })

    const id = generatePatientId()
    const hashed = await hashPasscode(passcode)

    await db.execute({
      sql: `INSERT INTO patients (id,name,dob,blood_group,passcode,email,phone,address,emergency_contact_name,emergency_contact_phone,emergency_contact_relation,allergies,medical_conditions)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id, name.trim(), dob ?? null, blood_group ?? null, hashed, email ?? null, phone ?? null, address ?? null,
        emergency_contact_name ?? null, emergency_contact_phone ?? null, emergency_contact_relation ?? null,
        allergies ?? null, medical_conditions ?? null]
    })

    return NextResponse.json({ id, name, message: 'Profile created' }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = await getDb()
    const body = await request.json()
    const { id, name, dob, blood_group, email, phone, address,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
      allergies, medical_conditions } = body

    const sessionId = getSessionPatientId(request)
    if (!sessionId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })
    if (id !== sessionId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await db.execute({
      sql: `UPDATE patients SET name=?,dob=?,blood_group=?,email=?,phone=?,address=?,
            emergency_contact_name=?,emergency_contact_phone=?,emergency_contact_relation=?,
            allergies=?,medical_conditions=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      args: [name, dob ?? null, blood_group ?? null, email ?? null, phone ?? null, address ?? null,
        emergency_contact_name ?? null, emergency_contact_phone ?? null, emergency_contact_relation ?? null,
        allergies ?? null, medical_conditions ?? null, id]
    })

    return NextResponse.json({ message: 'Updated' })
  } catch (e) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
