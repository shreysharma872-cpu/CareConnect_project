# CareConnect

CareConnect is an elderly care and medication management platform. Patients, family members and caretakers share one record of medications, doses, appointments, vitals, journal entries and care notes, and get email reminders when a dose or appointment needs attention. UI has been made easy for elderly people to be familiar with.

It is built with a **Next.js** web app, a **Rust (Axum)** API and **PostgreSQL**.

## Features

- **Patient profiles**: name, date of birth, blood group, allergies, medical conditions and emergency contact.
- **Passcode sign-in**: patients sign in with an ID and passcode. Passcodes are hashed with bcrypt and sessions use a signed cookie.
- **Care team access**: add family members, caretakers and admins to a patient's record.
- **Medications**: dosage, frequency, dose times, with-food flag, start and end dates, and notes.
- **Dose tracking**: each scheduled dose is `pending`, `taken` or `missed`. A rolling 30-day schedule is generated for active medications.
- **Appointments**: doctor, specialty, location and status (`scheduled`, `completed`, `cancelled`).
- **Vitals**: typed readings with units and notes.
- **Journal**: daily mood, energy level and symptoms.
- **Caretaker notes**: notes with an author, which can be marked important.
- **Adherence statistics**: adherence rate, taken and missed doses, active medications, upcoming appointments and daily stats.
- **Email reminders**: upcoming doses, missed doses (sent to caregivers) and appointment reminders.

## Tech stack

| Layer | Technology |
| --- | --- |
| Web app | Next.js, TypeScript, Tailwind CSS |
| API | Rust, Axum, Tokio |
| Database | PostgreSQL 14+ |
| Email | Resend (HTTPS), with a Gmail SMTP fallback for local use |
| Deployment | Render Blueprint (`render.yaml`) |

## How it works

```
Browser  ->  Next.js app  ->  /api/*  ->  Rust (Axum) API  ->  PostgreSQL
```

The Next.js app serves the pages and proxies `/api/*` calls to the Rust API. The API handles authentication, validation and all database access, and creates its tables and indexes on startup.

## Project layout

```
app/        Next.js pages (dashboard, medications, appointments, vitals,
            journal, care-team) and the reminder endpoint
backend/    Rust Axum API and PostgreSQL schema initialization
lib/        Dose schedule helper, email templates, reminder service
scripts/    Local launcher and the SQLite-to-PostgreSQL migration script
render.yaml Render Blueprint for deployment
```

## Getting started

### Requirements

- Node.js 18 or newer and npm
- Rust and Cargo
- PostgreSQL 14 or newer, local or hosted

### Setup

1. Create a PostgreSQL database named `careconnect`.
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL`:

   ```
   DATABASE_URL=postgres://postgres:your-password@localhost:5432/careconnect
   ```

3. Install dependencies and start both servers:

   ```
   npm install
   npm run dev
   ```

4. Open the URL printed by Next.js, usually `http://localhost:3000`.

The launcher starts the Rust API on port 4000, waits for its health check, then starts the website. Press `Ctrl+C` to stop both. The health endpoint is `http://127.0.0.1:4000/api/health`.

If `cargo` is not recognized after installing Rust, restart your terminal or add `%USERPROFILE%\.cargo\bin` to your PATH. The first build downloads and compiles Rust crates, so it takes a while.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `RUST_BACKEND_PORT`, `RUST_BACKEND_URL` | Port and address of the Rust API |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL` | App name and public URL |
| `SESSION_SECRET` | Signs session cookies. Required in production |
| `CRON_SECRET` | Bearer token for the reminder endpoint |
| `ENABLE_IN_APP_REMINDER_SCHEDULER` | Runs reminders inside the app when `true` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email delivery through Resend |
| `EMAIL_USER`, `EMAIL_PASS` | Optional Gmail SMTP fallback for local use |

Use long, random values for `SESSION_SECRET` and `CRON_SECRET`.

## Email reminders

- A dose gets a reminder when it is due within the next 30 minutes.
- A dose still pending 30 minutes after its scheduled time is marked missed and emailed to the patient and caregivers.
- Appointments get reminders 24 hours and 1 hour before the visit.

To send reminders on a schedule, call this endpoint from an external scheduler:

```
POST https://<your-web-service>/api/reminders/send
Authorization: Bearer <CRON_SECRET>
```

Set `RESEND_API_KEY` and a verified `EMAIL_FROM` sender for real email delivery.

## Build and start

```
npm run build              # Next.js web service
npm run build:fullstack    # Rust release build and Next.js build
npm start                  # Next.js only (Render web service)
npm run start:fullstack    # Rust and Next.js together
```

## Deploy to Render

The root `render.yaml` is a Render Blueprint for two free web services (Rust API and Next.js app) and a free PostgreSQL database.

1. Push the project to a Git repository.
2. In Render, create a new Blueprint and select the repository.
3. Render builds both services and connects the database and API address automatically.

Notes on the free tier:

- Free web services sleep after inactivity, so the first visit can be slow.
- The free PostgreSQL database is limited to 1 GB and expires after 30 days unless upgraded. Keep a separate backup.
- Free services cannot use SMTP ports, so use Resend for email.

## Migrating from SQLite

An older version used SQLite (`elderly_care.db`). To move that data to PostgreSQL:

1. Start the Rust API once so it creates the schema.
2. Run the migration script:

   ```
   $env:POSTGRES_DATABASE_URL = "postgres://postgres:your-password@localhost:5432/careconnect"
   $env:SQLITE_PATH = ".\elderly_care.db"
   node .\scripts\migrate-sqlite-to-postgres.mjs
   ```

For a hosted database, use its external connection string and add `?sslmode=require` (required by Render). The script preserves IDs, skips duplicates and rolls back everything if it fails. It prints row counts only, never patient data. Verify the records in the app before archiving the SQLite file.

## Security

- Never commit `.env.local`, passwords, API keys or patient data.
- Set `SESSION_SECRET` and `CRON_SECRET` before deploying.

## License

No license has been added yet. Add one before accepting contributions or sharing the code publicly.
