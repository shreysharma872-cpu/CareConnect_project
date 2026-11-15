import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { runReminderChecks } from '@/lib/reminder-service'

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const suppliedSecret = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (cronSecret) {
    const expected = Buffer.from(cronSecret), supplied = Buffer.from(suppliedSecret)
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Reminder job is not configured' }, { status: 503 })
  }

  try {
    const processed = await runReminderChecks()
    return NextResponse.json({ success: true, processed })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
