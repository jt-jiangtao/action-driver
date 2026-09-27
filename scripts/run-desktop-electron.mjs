import { runDesktopElectron } from './lib/desktop-electron-launch.mjs'
try {
  process.exitCode = await runDesktopElectron(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
