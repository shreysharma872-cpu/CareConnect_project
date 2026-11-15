# CareConnect

[![CI](https://github.com/shreysharma872-cpu/Elderly.Help_project/actions/workflows/ci.yml/badge.svg)](https://github.com/shreysharma872-cpu/Elderly.Help_project/actions/workflows/ci.yml)

CareConnect is an elderly care and medication management platform built with a Next.js web app, a Rust (Axum) API, and PostgreSQL. The API handles patient profiles, passcode sign-in, care-team access, medications, dose tracking, appointments, vitals, journal entries, caretaker notes, and adherence statistics.

## Run locally

### Requirements

- Node.js 18 or newer and npm
- Rust and Cargo
- PostgreSQL 14 or newer, running locally or hosted

Install the npm dependencies and create a PostgreSQL database named `careconnect`. Copy `.env.example` to `.env.local`, then set `DATABASE_URL` to your PostgreSQL connection string. For example:

```env
DATABASE_URL=postgres://postgres:your-password@localhost:5432/careconnect
```

Start both the Rust API and Next.js with one command:

```powershell
npm install
npm run dev
```

Open the URL printed by Next.js, usually `http://localhost:3000`. The launcher starts the Rust backend on port 4000, waits for its PostgreSQL health check, then starts the website. Keep the terminal open; `Ctrl+C` stops both. Rust initializes the PostgreSQL tables and indexes on startup. The API health endpoint is `http://127.0.0.1:4000/api/health`.

If `cargo` is not recognized after installing Rust, restart PowerShell or add `%USERPROFILE%\.cargo\bin` to PATH. The first build downloads and compiles Rust crates.

## Move existing SQLite data

The old `elderly_care.db` file is retained as a migration source. It is not used by the application. First start the Rust API once with the target PostgreSQL `DATABASE_URL` so it creates the schema. Then, from the project folder, run:

```powershell
$env:POSTGRES_DATABASE_URL = "postgres://postgres:your-password@localhost:5432/careconnect"
$env:SQLITE_PATH = ".\elderly_care.db"
node .\scripts\migrate-sqlite-to-postgres.mjs
```

For a hosted PostgreSQL database, use its external connection string as `POSTGRES_DATABASE_URL` (Render external URLs require SSL, usually by appending `?sslmode=require`). The migration preserves IDs, copies tables in foreign-key order, skips duplicate IDs, and rolls back all inserts if it fails. It prints row counts only, not patient data. Verify the records in the app before archiving or deleting the SQLite database and its `-wal`/`-shm` companions.

## Deploy to Render

The root `render.yaml` is a Render Blueprint for two free services (Rust API and Next.js web app) plus a free PostgreSQL database. Push the project to a Git repository, create a new Blueprint in Render, and select that repository. Render builds each service and wires its internal database and API address automatically. The Rust API binds to Render's `PORT` on `0.0.0.0`; the web service proxies `/api/*` calls to it.

Set `RESEND_API_KEY` on the `careconnect-web` service for real email. Resend uses HTTPS, which works from Render's free services; configure a verified sender and set `EMAIL_FROM`. Gmail SMTP is only a local fallback. For scheduled reminders, call `POST https://<your-web-service>/api/reminders/send` with `Authorization: Bearer <CRON_SECRET>` from an external scheduler. The in-app scheduler stays disabled in the Blueprint so it does not keep a free instance busy.

Render's free tier has limits that matter for a demo: free web services sleep after inactivity, so the first visit can take time to wake up; free PostgreSQL is limited to 1 GB and expires after 30 days unless upgraded during its grace period; free services cannot use SMTP ports. These limits are set by Render and are not application build errors. Keep a separate backup before the free database expires.

For a Render database migration, first let the deployed Rust API initialize its schema. Then run the migration script from your computer, with `POSTGRES_DATABASE_URL` set to that database's external URL and `SQLITE_PATH` pointing to the old local database. After verifying the deployed records, keep or archive the local SQLite copy as a backup.

## Build and start

```powershell
npm run build              # Next.js web service
npm run build:fullstack     # Rust release build and Next.js build
npm start                   # Next.js only (Render web service)
npm run start:fullstack     # Rust and Next.js together
```

On Render, deploy from the Blueprint rather than `start:fullstack`: the API and web app run as separate services there. Do not commit `.env.local`, passwords, API keys, or patient data.

## Project layout

- `backend/` — Rust Axum API and PostgreSQL access/schema initialization.
- `app/` — Next.js user interface and the reminder email endpoint.
- `lib/` — PostgreSQL email-reminder queries and dose schedule helper.
- `scripts/dev-fullstack.cjs` — starts/stops both local servers together.
- `scripts/migrate-sqlite-to-postgres.mjs` — one-time importer for the legacy SQLite database.
- `render.yaml` — Render Blueprint for the free-tier deployment.
