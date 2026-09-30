import { loadEnvFile } from 'node:process'
import { spawn } from 'node:child_process'

// Load only the developer's local, ignored configuration. Never distribute this file.
try {
  loadEnvFile('.env.local')
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('LOCAL_ENV_INVALID')
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { stdio: 'inherit', env: process.env })
    const interrupt = () => child.kill('SIGINT')
    const terminate = () => child.kill('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}

const built = await run(['--filter', '@action-driver/local-runtime', 'build'])
process.exitCode = built === 0 ? await run(['--filter', '@action-driver/desktop', 'dev']) : built
