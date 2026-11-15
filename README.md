<<<<<<< HEAD
# CareConnect — Elderly Care & Medication Management Platform

> PromptWars x Catalyst | Build with AI

## 🚀 Setup Instructions

### Prerequisites
- Node.js 18+ installed
- npm or pnpm

### 1. Install Dependencies

```bash
cd elderly-care-platform
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local`, then add your email credentials if you want email reminders:

```env
# To enable real email reminders (optional):
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-gmail-app-password  # Use Gmail App Password (not your login password)

# Required for production deployments:
SESSION_SECRET=replace-with-a-long-random-secret
CRON_SECRET=replace-with-another-long-random-secret
ENABLE_IN_APP_REMINDER_SCHEDULER=false
```

**To get a Gmail App Password:**
1. Enable 2FA on your Google account
2. Go to myaccount.google.com → Security → App Passwords
3. Generate an app password for "Mail"

> Without email config, the app still works — reminders are logged to the console.

### 3. Run the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🏗️ Features

| Feature | Description |
|---------|-------------|
| 👤 Patient Profile | Create a profile with medical info, emergency contacts, allergies |
| 🔐 Passcode Access | Secure 8-char Patient ID + passcode, backed by signed HTTP-only sessions |
| 💊 Medications | Daily and weekly schedules with rolling 30-day dose tracking; as-needed medicines stay unscheduled |
| ✅ Dose Tracking | Mark doses taken/missed directly from dashboard |
| 📅 Appointments | Schedule doctor appointments with location and notes |
| 📧 Email Reminders | Upcoming and missed dose alerts + 24h/1h appointment reminders for the patient and care team |
| 👨‍👩‍👧 Care Team | Add family/caretaker contacts who receive reminder emails |
| 📊 Vitals | Track BP, blood sugar, weight, temperature, pulse, O2 |
| 📝 Health Journal | Daily mood/energy/symptom log |
| 👨‍⚕️ Caretaker Notes | Shared notes between caretakers with importance flag |
| 📈 Adherence Chart | 7-day visual adherence bar chart on dashboard |

## 📁 Project Structure

```
elderly-care-platform/
├── app/
│   ├── page.tsx              # Landing / Login / Register
│   ├── dashboard/page.tsx    # Main dashboard
│   ├── medications/page.tsx  # Medication manager
│   ├── appointments/page.tsx # Appointment scheduler
│   ├── care-team/page.tsx    # Trusted reminder contacts
│   ├── vitals/page.tsx       # Vitals tracker
│   ├── journal/page.tsx      # Health journal + caretaker notes
│   └── api/                  # REST API routes
│       ├── patients/
│       ├── medications/
│       ├── doses/
│       ├── appointments/
│       ├── vitals/
│       ├── journal/
│       ├── caretaker-notes/
│       ├── stats/
│       └── reminders/send/   # POST to trigger reminder check
├── lib/
│   ├── db.ts                 # SQLite setup + schema
│   ├── auth.ts               # Passcode hash/verify
│   ├── session.ts            # Signed HTTP-only sessions
│   ├── dose-schedule.ts      # Rolling medication schedules
│   ├── reminder-scheduler.ts # In-process reminder scheduler
│   ├── email.ts              # Nodemailer + templates
│   └── utils.ts              # Shared utilities
└── .env.local                # Configuration
```

## 🔔 Triggering Email Reminders

The reminder endpoint handles upcoming doses (within 30 minutes), missed doses (30 minutes overdue), and appointments (24 hours and 1 hour ahead). The development server runs reminder checks every 5 minutes automatically. For a persistent Node.js production server, set `ENABLE_IN_APP_REMINDER_SCHEDULER=true` and configure `CRON_SECRET`:

```bash
curl -X POST http://localhost:3000/api/reminders/send
```

This checks:
- Doses missed by >30 minutes → marks as missed + sends alert email
- Doses due in ~30 minutes → sends upcoming reminder
- Appointments in ~24 hours → sends 24h reminder
- Appointments in ~1 hour → sends 1h reminder

For serverless production hosting, configure a scheduled HTTP job to POST to `/api/reminders/send` every 5 minutes with `Authorization: Bearer $CRON_SECRET`. Use either the in-process scheduler or an external job so reminders are not sent twice.

Sign-in creates a seven-day, signed, HTTP-only session cookie. Production must set `SESSION_SECRET` to a long, random value. Patient data APIs only return or modify records for the signed-in patient. Family members and caretakers use the patient ID and passcode shared by the patient to sign into the same care profile.

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: Local SQLite via `@libsql/client` (zero setup)
- **Email**: Nodemailer + Gmail SMTP
- **Auth**: bcrypt passcode hashing

## Full-stack runtime

This is a single Next.js application: `npm run dev` starts both the web UI and its backend API routes. The API initializes a local SQLite database at `DATABASE_PATH` on its first request; no separate database server or backend terminal is required. The database health endpoint at `/api/health` reports whether SQLite is connected.

For a production self-hosted run:

```bash
npm run build
npm run start
```

Set `SESSION_SECRET` and `CRON_SECRET` in the production environment before starting. Configure email SMTP values to deliver real reminders.
=======
# Elderly.Help_project
project made for the betterment of the society, helping the society
>>>>>>> f03308de75639c7a76c3291c3d8e4034564d68f2
