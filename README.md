# CareConnect

CareConnect is an elderly care and medication management platform for patients, family members, and caretakers. It combines a Next.js web interface, a Rust REST API, and a local SQLite database.

## Run the full project

### Requirements

- Node.js 18 or newer and npm
- Rust stable (`rustc` and `cargo`)

From the project directory, install the web dependencies and start both servers:

```powershell
npm install
npm run dev
```

The launcher compiles and starts the Rust API on `http://127.0.0.1:4000`, waits for its SQLite health check, and then starts Next.js. Open the URL shown by Next.js (usually `http://localhost:3000`). Keep that terminal open while using the app; press `Ctrl+C` to stop both servers.

The first Rust start downloads and compiles crates and can take a few minutes. If Rust is installed but `cargo` is not recognized in a new terminal, reopen PowerShell or add `%USERPROFILE%\.cargo\bin` to PATH.

## Configuration and database

The app reads `.env.local` from the project root. If this file is missing, create it from `.env.example`. The default database is `elderly_care.db` in the project root; set `DATABASE_PATH` to change it. Rust initializes/migrates the SQLite schema and enables WAL mode, foreign keys, common query indexes, and a five-second busy timeout.

Set a long random `SESSION_SECRET` before deploying. Email reminders use the configured `EMAIL_USER`, `EMAIL_PASS`, and optional `EMAIL_FROM` SMTP settings. Without SMTP credentials, core profile, medication, appointment, dose, and health-record features still work; real email delivery requires valid SMTP credentials and the reminder scheduler.

## Backend layout

- `backend/` — Rust API using Axum and SQLite. Handles registration, bcrypt passcodes, signed HTTP-only sessions, profiles, medication schedules, dose logs, appointments, vitals, journal entries, care-team contacts, caretaker notes, and adherence statistics.
- `app/` — Next.js web application. Rewrites the data APIs to the Rust service. The email reminder endpoint remains in Next.js and uses Nodemailer to deliver SMTP messages.
- `scripts/dev-fullstack.cjs` — starts the Rust API, waits for the database health check, then starts Next.js; shuts down both processes together.
- `elderly_care.db` — local SQLite database, created on first run when absent.

The Rust API health check is available at `http://127.0.0.1:4000/api/health`. Its response reports the application, backend language, and database connection status.

## Build and production start

```powershell
npm run build
npm run start
```

The build compiles the Rust service and the Next.js app. Production startup runs the Rust service in release mode and starts the Next.js production server. Configure `SESSION_SECRET`, `CRON_SECRET`, `DATABASE_PATH`, and SMTP credentials in the production environment. Do not commit `.env.local` or the SQLite database.

## Main features

- Patient profiles with emergency contacts and secure sign-in
- Daily and weekly medication schedules with dose tracking and adherence insights
- Appointment scheduling and reminder emails
- Care-team contacts for shared reminders
- Vitals, health journal, and caretaker notes
