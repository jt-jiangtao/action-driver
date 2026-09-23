import { copyFile, chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rgPath } from '@vscode/ripgrep'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(packageRoot, 'dist', 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg')
await mkdir(dirname(destination), { recursive: true })
await copyFile(rgPath, destination)
await chmod(destination, 0o755)
