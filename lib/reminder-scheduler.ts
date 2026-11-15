const runtime = globalThis as typeof globalThis & { __careConnectReminderTimer?: NodeJS.Timeout }

async function findCareConnectUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || '3000'}`
  const candidates = [configured]
  if (process.env.NODE_ENV === 'development') {
    try {
      const parsed = new URL(configured)
      if (['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        for (let port = 3000; port <= 3010; port++) {
          const candidate = new URL(configured)
          candidate.port = String(port)
          if (!candidates.includes(candidate.origin)) candidates.push(candidate.origin)
        }
      }
    } catch { /* Keep the configured base URL and let the request report its error. */ }
  }

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(new URL('/api/health', baseUrl), { signal: AbortSignal.timeout(2000) })
      if (response.ok) {
        const status = await response.json()
        if (status?.application === 'careconnect') return baseUrl
      }
    } catch { /* Try the next local development port. */ }
  }
  throw new Error('Could not find the CareConnect server on its configured port.')
}

export function startReminderScheduler() {
  if (runtime.__careConnectReminderTimer) return
  if (process.env.NODE_ENV === 'production' && !process.env.CRON_SECRET) {
    console.error('[CareConnect] Reminder scheduler requires CRON_SECRET in production.')
    return
  }

  let running = false
  const checkReminders = async () => {
    if (running) return
    running = true
    try {
      const baseUrl = await findCareConnectUrl()
      const headers: Record<string, string> = {}
      if (process.env.CRON_SECRET) headers.Authorization = `Bearer ${process.env.CRON_SECRET}`
      const response = await fetch(new URL('/api/reminders/send', baseUrl), { method: 'POST', headers, signal: AbortSignal.timeout(120000) })
      if (!response.ok) console.error(`[CareConnect] Reminder check failed: HTTP ${response.status}`)
    } catch (error) {
      console.error('[CareConnect] Reminder check failed:', error)
    } finally {
      running = false
    }
  }
  runtime.__careConnectReminderTimer = setInterval(() => { void checkReminders() }, 5 * 60 * 1000)
  runtime.__careConnectReminderTimer.unref()
  console.info('[CareConnect] Medication and appointment reminders scheduled every 5 minutes.')
}
