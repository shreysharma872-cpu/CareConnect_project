import { getDb } from '@/lib/db'
import { sendEmail, missedDoseEmailTemplate, upcomingDoseEmailTemplate, appointmentReminderEmailTemplate } from '@/lib/email'
import { format, subMinutes, addMinutes, addHours, parseISO } from 'date-fns'
import { ensureDoseSchedule } from '@/lib/dose-schedule'

function emailRecipients(patientEmail: unknown, caregiverEmails: unknown) {
  return [...new Set([patientEmail, ...(typeof caregiverEmails === 'string' ? caregiverEmails.split(',') : [])]
    .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
    .map(email => email.trim()))]
}

export async function runReminderChecks() {
  const db = await getDb(), now = new Date()
  const patients = await db.execute('SELECT DISTINCT patient_id FROM medications WHERE active=1')
  for (const patient of patients.rows) await ensureDoseSchedule(db, String(patient.patient_id))

  const caregiverJoin = `LEFT JOIN (SELECT patient_id,GROUP_CONCAT(DISTINCT email) AS caregiver_emails FROM authorized_users WHERE role IN ('admin','caretaker','family') GROUP BY patient_id) au ON au.patient_id=`
  const upcoming = await db.execute({
    sql: `SELECT dl.*,m.name AS med_name,m.dosage,m.dosage_unit,p.name AS patient_name,p.email AS patient_email,au.caregiver_emails FROM dose_logs dl JOIN medications m ON dl.medication_id=m.id JOIN patients p ON dl.patient_id=p.id ${caregiverJoin}dl.patient_id WHERE dl.status='pending' AND dl.scheduled_time>? AND dl.scheduled_time<=? AND dl.reminder_sent=0 AND m.active=1`,
    args: [now.toISOString(), addMinutes(now, 30).toISOString()],
  })
  for (const dose of upcoming.rows as any[]) {
    const recipients = emailRecipients(dose.patient_email, dose.caregiver_emails)
    const sent = recipients.length ? await sendEmail({
      to: recipients, subject: `Medication reminder — ${dose.med_name}`,
      html: upcomingDoseEmailTemplate({ patientName: String(dose.patient_name), medicationName: String(dose.med_name), dosage: `${dose.dosage} ${dose.dosage_unit}`, scheduledTime: format(parseISO(String(dose.scheduled_time)), 'h:mm a') }),
    }) : null
    if (!recipients.length || sent?.success) await db.execute({ sql: 'UPDATE dose_logs SET reminder_sent=1 WHERE id=?', args: [dose.id] })
  }

  const missed = await db.execute({
    sql: `SELECT dl.*,m.name AS med_name,m.dosage,m.dosage_unit,p.name AS patient_name,p.email AS patient_email,au.caregiver_emails FROM dose_logs dl JOIN medications m ON dl.medication_id=m.id JOIN patients p ON dl.patient_id=p.id ${caregiverJoin}dl.patient_id WHERE ((dl.status='pending' AND dl.scheduled_time<=?) OR (dl.status='missed' AND dl.missed_reminder_sent=0)) AND m.active=1`,
    args: [subMinutes(now, 30).toISOString()],
  })
  for (const dose of missed.rows as any[]) {
    await db.execute({ sql: "UPDATE dose_logs SET status='missed' WHERE id=?", args: [dose.id] })
    const recipients = emailRecipients(dose.patient_email, dose.caregiver_emails)
    const sent = recipients.length ? await sendEmail({
      to: recipients, subject: `Missed dose — ${dose.med_name} for ${dose.patient_name}`,
      html: missedDoseEmailTemplate({ patientName: String(dose.patient_name), medicationName: String(dose.med_name), dosage: `${dose.dosage} ${dose.dosage_unit}`, scheduledTime: format(parseISO(String(dose.scheduled_time)), 'h:mm a') }),
    }) : null
    if (!recipients.length || sent?.success) await db.execute({ sql: 'UPDATE dose_logs SET missed_reminder_sent=1 WHERE id=?', args: [dose.id] })
  }

  const appointments24h = await db.execute({
    sql: `SELECT a.*,p.name AS patient_name,p.email AS patient_email,au.caregiver_emails FROM appointments a JOIN patients p ON a.patient_id=p.id ${caregiverJoin}a.patient_id WHERE a.status='scheduled' AND a.appointment_datetime>=? AND a.appointment_datetime<=? AND a.reminder_24h_sent=0`,
    args: [addHours(now, 23).toISOString(), addHours(now, 25).toISOString()],
  })
  for (const appointment of appointments24h.rows as any[]) {
    const recipients = emailRecipients(appointment.patient_email, appointment.caregiver_emails)
    const sent = recipients.length ? await sendEmail({
      to: recipients, subject: `Appointment tomorrow — Dr. ${appointment.doctor_name}`,
      html: appointmentReminderEmailTemplate({ patientName: String(appointment.patient_name), doctorName: String(appointment.doctor_name), specialty: String(appointment.specialty || ''), appointmentDateTime: format(parseISO(String(appointment.appointment_datetime)), 'MMM d, yyyy h:mm a'), location: String(appointment.location || ''), hoursUntil: 24 }),
    }) : null
    if (!recipients.length || sent?.success) await db.execute({ sql: 'UPDATE appointments SET reminder_24h_sent=1 WHERE id=?', args: [appointment.id] })
  }

  const appointments1h = await db.execute({
    sql: `SELECT a.*,p.name AS patient_name,p.email AS patient_email,au.caregiver_emails FROM appointments a JOIN patients p ON a.patient_id=p.id ${caregiverJoin}a.patient_id WHERE a.status='scheduled' AND a.appointment_datetime>=? AND a.appointment_datetime<=? AND a.reminder_1h_sent=0`,
    args: [addMinutes(now, 55).toISOString(), addMinutes(now, 65).toISOString()],
  })
  for (const appointment of appointments1h.rows as any[]) {
    const recipients = emailRecipients(appointment.patient_email, appointment.caregiver_emails)
    const sent = recipients.length ? await sendEmail({
      to: recipients, subject: `Appointment in 1 hour — Dr. ${appointment.doctor_name}`,
      html: appointmentReminderEmailTemplate({ patientName: String(appointment.patient_name), doctorName: String(appointment.doctor_name), specialty: String(appointment.specialty || ''), appointmentDateTime: format(parseISO(String(appointment.appointment_datetime)), 'MMM d, yyyy h:mm a'), location: String(appointment.location || ''), hoursUntil: 1 }),
    }) : null
    if (!recipients.length || sent?.success) await db.execute({ sql: 'UPDATE appointments SET reminder_1h_sent=1 WHERE id=?', args: [appointment.id] })
  }

  return { upcomingDoses: upcoming.rows.length, missedDoses: missed.rows.length, appointments24h: appointments24h.rows.length, appointments1h: appointments1h.rows.length }
}
