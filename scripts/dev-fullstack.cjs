const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const production = process.argv.includes('--production')
const isWindows = process.platform === 'win32'
const root = process.cwd()
const backendPort = Number(process.env.RUST_BACKEND_PORT || 4000)
const backendUrl = process.env.RUST_BACKEND_URL || `http://127.0.0.1:${backendPort}`
function findCargo() {
  if (process.env.CARGO) return process.env.CARGO
  if (isWindows) {
    const cargoHome = process.env.CARGO_HOME || join(process.env.USERPROFILE || '', '.cargo')
    const installedCargo = join(cargoHome, 'bin', 'cargo.exe')
    if (existsSync(installedCargo)) return installedCargo
  }
  return 'cargo'
}

const cargo = findCargo()
const frontendScript = production ? 'start:next' : 'dev:next'
const npmCli = process.env.npm_execpath
const cargoEnv = {
  ...process.env,
  CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || join(isWindows ? (process.env.TEMP || root) : root, 'careconnect-cargo-target'),
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || '2',
}

let stopping = false
let frontend = null
let backend = null
let readinessTimer = null
let readinessAttempts = 0
let reusedBackend = false

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
  console.log(`[CareConnect] Rust API and PostgreSQL are healthy at ${backendUrl}${reusedBackend ? ' (reusing existing API)' : ''}. Starting Next.js.`)
  const command = npmCli ? process.execPath : (isWindows ? 'cmd.exe' : 'npm')
  const args = npmCli
    ? [npmCli, 'run', frontendScript]
    : (isWindows ? ['/d', '/s', '/c', 'npm', 'run', frontendScript] : ['run', frontendScript])
  frontend = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      CARECONNECT_NEXT_DIST_DIR: process.env.CARECONNECT_NEXT_DIST_DIR || (production ? '.next' : '.next-dev'),
    },
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

async function startFrontendIfNeeded() {
  const frontendPort = Number(process.env.PORT || 3000)
  try {
    const response = await fetch(`http://127.0.0.1:${frontendPort}/`, { signal: AbortSignal.timeout(1000) })
    const html = await response.text()
    if (response.ok && html.includes('CareConnect')) {
      console.log(`[CareConnect] Website is already responding at http://localhost:${frontendPort}; reusing it.`)
      return
    }
  } catch { /* No CareConnect web app is ready on the default port. */ }
  startFrontend()
}

async function waitForBackend() {
  if (stopping || frontend) return
  readinessAttempts += 1
  try {
    const response = await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(1500) })
    const health = await response.json()
    if (response.ok && health?.status === 'ok' && health?.database === 'connected' && health?.backend === 'rust') {
      await startFrontendIfNeeded()
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

function startBackend() {
  if (stopping || backend) return
  backend = spawn(cargo, ['run', ...(production ? ['--release'] : []), '--manifest-path', 'backend/Cargo.toml'], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: cargoEnv,
  })
  backend.on('error', error => {
    console.error(`Rust backend failed to start with Cargo at "${cargo}". Install Rust or set CARGO to cargo.exe:`, error.message)
    stop(1)
  })
  backend.on('exit', code => {
    if (!stopping) {
      console.error(`Rust backend exited (${code ?? 'unknown'}). Check whether port ${backendPort} is already in use.`)
      stop(code || 1)
    }
  })
}

async function start() {
  console.log(`[CareConnect] Checking Rust API at ${backendUrl}.`)
  try {
    const response = await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(1000) })
    const health = await response.json()
    if (response.ok && health?.status === 'ok' && health?.database === 'connected' && health?.backend === 'rust') {
      reusedBackend = true
      await startFrontendIfNeeded()
      return
    }
  } catch { /* No compatible API is running yet. */ }

  console.log(`[CareConnect] Starting Rust API on port ${backendPort}; waiting for database health before starting Next.js.`)
  startBackend()
  void waitForBackend()
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

void start()
