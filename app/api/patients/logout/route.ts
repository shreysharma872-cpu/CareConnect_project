import { NextResponse } from 'next/server'
import { COOKIE_NAME, sessionCookieOptions } from '@/lib/session'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set(COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 })
  return response
}
