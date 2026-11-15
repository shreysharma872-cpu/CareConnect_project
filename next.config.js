/** @type {import('next').NextConfig} */
const configuredBackend = process.env.RUST_BACKEND_URL || process.env.RUST_BACKEND_HOSTPORT
const rustBackend = configuredBackend
  ? (/^https?:\/\//i.test(configuredBackend) ? configuredBackend : `http://${configuredBackend}`)
  : 'http://127.0.0.1:4000'
const rustApiPaths = [
  '/health',
  '/patients',
  '/patients/:path*',
  '/medications',
  '/doses',
  '/appointments',
  '/vitals',
  '/journal',
  '/caretaker-notes',
  '/care-team',
  '/stats',
]

const nextConfig = {
  async rewrites() {
    return {
      beforeFiles: rustApiPaths.map(path => ({ source: `/api${path}`, destination: `${rustBackend}/api${path}` })),
    }
  },
}

module.exports = nextConfig
