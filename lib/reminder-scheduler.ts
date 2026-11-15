import { runReminderChecks } from './reminder-service'

const runtime = globalThis as typeof globalThis & { __careConnectReminderTimer?: NodeJS.Timeout }

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
      const processed = await runReminderChecks()
      console.info('[CareConnect] Reminder check complete:', processed)
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
