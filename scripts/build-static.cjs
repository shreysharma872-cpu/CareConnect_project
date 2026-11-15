const { spawnSync } = require('node:child_process')

const nextCli = require.resolve('next/dist/bin/next')
const result = spawnSync(process.execPath, [nextCli, 'build'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    RENDER_STATIC_EXPORT: 'true',
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:4000',
  },
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
