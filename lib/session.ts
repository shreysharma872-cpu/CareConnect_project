import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

const COOKIE_NAME = 'careconnect_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
const developmentSecret = 'careconnect-local-development-secret-not-for-production'

function getSecret() {
  const secret = process.env.SESSION_SECRET
  if (process.env.NODE_ENV === 'production' && !secret) throw new Error('SESSION_SECRET must be configured in production')
  return secret || developmentSecret
}

export function createSessionToken(patientId: string) {
  const payload = Buffer.from(JSON.stringify({ sub: patientId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })).toString('base64url')
  const signature = createHmac('sha256', getSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function getSessionPatientId(request: NextRequest): string | null {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  try {
    const expected = createHmac('sha256', getSecret()).update(payload).digest()
    const received = Buffer.from(signature, 'base64url')
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) return null
    return claims.sub
  } catch {
    return null
  }
}

export function sessionCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: SESSION_TTL_SECONDS }
}

export { COOKIE_NAME }
