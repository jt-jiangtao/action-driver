import { copyFile, chmod, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { rgPath } from '@vscode/ripgrep'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(packageRoot, 'dist', 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg')
await mkdir(dirname(destination), { recursive: true })
// Overwriting a signed binary in place keeps its inode, and macOS then kills it for a signature
// that no longer matches the cached one. A fresh file gets a fresh inode.
await rm(destination, { force: true })
await copyFile(rgPath, destination)
await chmod(destination, 0o755)
