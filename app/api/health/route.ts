import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  try {
    const db = await getDb()
    await db.execute('SELECT 1 AS connected')
    return NextResponse.json({ application: 'careconnect', status: 'ok', database: 'connected' })
  } catch (error) {
    console.error('[CareConnect health check]', error)
    return NextResponse.json({ application: 'careconnect', status: 'degraded', database: 'unavailable' }, { status: 503 })
  }
}
