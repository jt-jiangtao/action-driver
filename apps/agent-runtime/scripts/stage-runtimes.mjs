import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, mkdtemp, readFile, rename, rm, chmod, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(join(root, 'scripts', 'runtime-lock.json'), 'utf8'))

export function runtimeArtifactFor(platform, arch) {
  const entry = lock[`${platform}-${arch}`]
  if (!entry) throw new Error(`RUNTIME_ARCH_UNSUPPORTED: ${platform}-${arch}`)
  return entry
}

export function verifySha256(bytes, expected) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error('RUNTIME_ARCHIVE_CHECKSUM_MISMATCH')
  }
}

async function archiveFor(artifact) {
  const cache = join(root, '.runtime-cache', artifact.file)
  await mkdir(dirname(cache), { recursive: true })
  try {
    const bytes = await readFile(cache)
    verifySha256(bytes, artifact.sha256)
    return cache
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const response = await globalThis.fetch(artifact.url)
  if (!response.ok) throw new Error(`RUNTIME_ARCHIVE_DOWNLOAD_FAILED: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  verifySha256(bytes, artifact.sha256)
  const temporary = `${cache}.${process.pid}.tmp`
  await writeFile(temporary, bytes)
  await rename(temporary, cache)
  return cache
}

export async function stageRuntime(kind, artifact, target) {
  const archive = await archiveFor(artifact)
  const temporary = await mkdtemp(join(tmpdir(), 'action-driver-runtime-'))
  try {
    await exec('/usr/bin/tar', ['-xzf', archive, '-C', temporary], { maxBuffer: 1024 * 1024 })
    const source = kind === 'python' ? join(temporary, 'python') : join(temporary, artifact.file.replace(/\.tar\.gz$/, ''))
    const binary = kind === 'python' ? join(source, 'bin', 'python3') : join(source, 'bin', 'node')
    await access(binary)
    await mkdir(dirname(target), { recursive: true })
    await rm(target, { recursive: true, force: true })
    await rename(source, target)
    await chmod(join(target, 'bin', kind === 'python' ? 'python3' : 'node'), 0o755)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const artifacts = runtimeArtifactFor(process.platform, process.arch)
  const target = join(root, 'dist', 'runtimes', `${process.platform}-${process.arch}`)
  for (const kind of ['python', 'node']) {
    await stageRuntime(kind, artifacts[kind], join(target, kind))
  }
}
