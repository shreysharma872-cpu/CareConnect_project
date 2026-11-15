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
  distDir: process.env.CARECONNECT_NEXT_DIST_DIR || '.next',
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'" },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }]
  },
  async rewrites() {
    return {
      beforeFiles: rustApiPaths.map(path => ({ source: `/api${path}`, destination: `${rustBackend}/api${path}` })),
    }
  },
}

module.exports = nextConfig
