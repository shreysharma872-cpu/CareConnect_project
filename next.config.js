/** @type {import('next').NextConfig} */
const rustBackend = process.env.RUST_BACKEND_URL || 'http://127.0.0.1:4000'
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
