export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const enabled = process.env.NODE_ENV === 'development' || process.env.ENABLE_IN_APP_REMINDER_SCHEDULER === 'true'
  if (!enabled) return
  const { startReminderScheduler } = await import('./lib/reminder-scheduler')
  startReminderScheduler()
}
