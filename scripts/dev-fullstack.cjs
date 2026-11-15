const { spawn } = require('node:child_process')

const production = process.argv.includes('--production')
const isWindows = process.platform === 'win32'
const root = process.cwd()
const backendPort = Number(process.env.RUST_BACKEND_PORT || 4000)
const backendUrl = process.env.RUST_BACKEND_URL || `http://127.0.0.1:${backendPort}`
const shell = isWindows

let stopping = false
let frontend = null
let readinessTimer = null
let readinessAttempts = 0

const backend = spawn('cargo', ['run', ...(production ? ['--release'] : []), '--manifest-path', 'backend/Cargo.toml'], {
  cwd: root,
  stdio: 'inherit',
  shell,
  env: process.env,
})

function terminate(child) {
  if (!child || child.killed || child.exitCode !== null) return
  if (isWindows && child.pid) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.on('error', () => child.kill())
  } else {
    child.kill('SIGTERM')
  }
}

function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (readinessTimer) clearTimeout(readinessTimer)
  terminate(backend)
  terminate(frontend)
  process.exitCode = code
}

function startFrontend() {
  if (stopping || frontend) return
  console.log(`[CareConnect] Rust API and SQLite are healthy at ${backendUrl}. Starting Next.js.`)
  frontend = spawn('npm', ['run', production ? 'start:next' : 'dev:next'], {
    cwd: root,
    stdio: 'inherit',
    shell,
    env: process.env,
  })
  frontend.on('error', error => {
    console.error('Next.js failed to start:', error.message)
    stop(1)
  })
  frontend.on('exit', code => {
    if (!stopping) {
      console.error(`Next.js exited (${code ?? 'unknown'}).`)
      stop(code || 1)
    }
  })
}

async function waitForBackend() {
  if (stopping || frontend) return
  readinessAttempts += 1
  try {
    const response = await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(1500) })
    const health = await response.json()
    if (response.ok && health?.status === 'ok' && health?.database === 'connected' && health?.backend === 'rust') {
      startFrontend()
      return
    }
  } catch { /* Rust may still be compiling or creating the database. */ }

  if (readinessAttempts >= 300) {
    console.error(`[CareConnect] Rust backend did not become healthy at ${backendUrl} after 5 minutes.`)
    stop(1)
    return
  }
  readinessTimer = setTimeout(waitForBackend, 1000)
}

backend.on('error', error => {
  console.error('Rust backend failed to start. Install Rust and ensure cargo is on PATH:', error.message)
  stop(1)
})
backend.on('exit', code => {
  if (!stopping) {
    console.error(`Rust backend exited (${code ?? 'unknown'}). Check whether port ${backendPort} is already in use.`)
    stop(code || 1)
  }
})

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

console.log(`[CareConnect] Starting Rust API on port ${backendPort}; waiting for database health before starting Next.js.`)
void waitForBackend()
