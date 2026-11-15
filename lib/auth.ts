import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'

export async function hashPasscode(passcode: string): Promise<string> {
  return bcrypt.hash(passcode, 10)
}

export async function verifyPasscode(passcode: string, hash: string): Promise<boolean> {
  return bcrypt.compare(passcode, hash)
}

export function generatePatientId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(randomInt(chars.length))
  }
  return id
}
