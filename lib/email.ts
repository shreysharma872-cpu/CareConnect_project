import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

interface EmailOptions {
  to: string | string[]
  subject: string
  html: string
}

export async function sendEmail(options: EmailOptions) {
  if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your-gmail@gmail.com') {
    console.log('[Email Mock] Would send:', { to: options.to, subject: options.subject })
    return { success: true, mock: true }
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || `CareConnect <${process.env.EMAIL_USER}>`,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('[Email Error]', error)
    return { success: false, error }
  }
}

export function missedDoseEmailTemplate(params: {
  patientName: string
  medicationName: string
  dosage: string
  scheduledTime: string
  caretakerName?: string
}) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:20px}
    .container{max-width:600px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}
    .header{background:linear-gradient(135deg,#0f766e,#14b8a6);padding:32px;text-align:center}
    .header h1{color:white;margin:0;font-size:24px}.header p{color:rgba(255,255,255,.85);margin:8px 0 0}
    .body{padding:32px}.alert-box{background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin:20px 0}
    .alert-box h2{color:#dc2626;margin:0 0 8px;font-size:18px}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9}
    .lbl{color:#64748b;font-size:14px}.val{color:#0f172a;font-weight:600}
    .footer{background:#f8fafc;padding:24px;text-align:center;color:#94a3b8;font-size:13px}
    .btn{display:inline-block;background:#14b8a6;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;margin:16px 0}
  </style></head><body>
  <div class="container">
    <div class="header"><h1>⚕️ CareConnect</h1><p>Medication Reminder Alert</p></div>
    <div class="body">
      <p>Hello${params.caretakerName ? ` ${params.caretakerName}` : ''},</p>
      <p><strong>${params.patientName}</strong> has missed a scheduled medication dose.</p>
      <div class="alert-box"><h2>⚠️ Missed Dose Alert</h2><p>Please ensure the medication is taken as soon as possible.</p></div>
      <div>
        <div class="row"><span class="lbl">Patient</span><span class="val">${params.patientName}</span></div>
        <div class="row"><span class="lbl">Medication</span><span class="val">${params.medicationName}</span></div>
        <div class="row"><span class="lbl">Dosage</span><span class="val">${params.dosage}</span></div>
        <div class="row"><span class="lbl">Scheduled Time</span><span class="val">${params.scheduledTime}</span></div>
      </div>
      <center><a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}" class="btn">View Dashboard</a></center>
    </div>
    <div class="footer"><p>CareConnect — Elderly Care &amp; Medication Management</p></div>
  </div></body></html>`
}

export function upcomingDoseEmailTemplate(params: { patientName: string; medicationName: string; dosage: string; scheduledTime: string }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a"><div style="max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0"><h1 style="color:#0f766e">CareConnect dose reminder</h1><p>Hello ${params.patientName},</p><p>It is almost time for your medication.</p><div style="background:#f0fdfa;padding:18px;border-radius:12px"><strong>${params.medicationName}</strong><br/>${params.dosage}<br/>Scheduled for ${params.scheduledTime}</div><p style="color:#64748b;font-size:13px">Please follow the instructions provided by your healthcare professional.</p></div></body></html>`
}

export function appointmentReminderEmailTemplate(params: {
  patientName: string
  doctorName: string
  specialty: string
  appointmentDateTime: string
  location: string
  hoursUntil: number
}) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:20px}
    .container{max-width:600px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}
    .header{background:linear-gradient(135deg,#1d4ed8,#3b82f6);padding:32px;text-align:center}
    .header h1{color:white;margin:0;font-size:24px}.header p{color:rgba(255,255,255,.85);margin:8px 0 0}
    .body{padding:32px}.appt-box{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;margin:20px 0}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9}
    .lbl{color:#64748b;font-size:14px}.val{color:#0f172a;font-weight:600}
    .footer{background:#f8fafc;padding:24px;text-align:center;color:#94a3b8;font-size:13px}
    .btn{display:inline-block;background:#3b82f6;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;margin:16px 0}
  </style></head><body>
  <div class="container">
    <div class="header"><h1>⚕️ CareConnect</h1><p>Appointment Reminder</p></div>
    <div class="body">
      <p><strong>${params.patientName}</strong> has a doctor's appointment in <strong>${params.hoursUntil} hour${params.hoursUntil !== 1 ? 's' : ''}</strong>.</p>
      <div class="appt-box"><p style="margin:0;color:#1d4ed8;font-weight:600">📅 Upcoming Appointment</p></div>
      <div>
        <div class="row"><span class="lbl">Doctor</span><span class="val">Dr. ${params.doctorName}</span></div>
        <div class="row"><span class="lbl">Specialty</span><span class="val">${params.specialty || 'General'}</span></div>
        <div class="row"><span class="lbl">Date &amp; Time</span><span class="val">${params.appointmentDateTime}</span></div>
        <div class="row"><span class="lbl">Location</span><span class="val">${params.location || 'To be confirmed'}</span></div>
      </div>
      <center><a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}" class="btn">View Appointment</a></center>
    </div>
    <div class="footer"><p>CareConnect — Elderly Care &amp; Medication Management</p></div>
  </div></body></html>`
}
