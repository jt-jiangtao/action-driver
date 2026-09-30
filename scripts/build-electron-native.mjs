#!/usr/bin/env node
/**
 * Builds the Electron ABI binding for better-sqlite3 without touching the pnpm managed Node binding.
 *
 * The local Agent Runtime runs inside an Electron utility process, which uses Electron's own Node
 * ABI. Copying the package out of the pnpm store keeps `node_modules` untouched so unit tests keep
 * loading the Node binding installed by pnpm.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const METADATA_FILE = 'binding.json'
const BINDING_FILE = 'better_sqlite3.node'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = join(projectRoot, 'apps/local-runtime')
const desktopRequire = createRequire(join(projectRoot, 'apps/desktop/package.json'))
const runtimeRequire = createRequire(join(runtimeRoot, 'package.json'))

const arch = process.env.ACTION_DRIVER_NATIVE_ARCH?.trim() || process.arch
const electronVersion = desktopRequire('electron/package.json').version
const outputDirectory = join(runtimeRoot, 'native', 'electron', arch)
const bindingPath = join(outputDirectory, BINDING_FILE)
const metadataPath = join(outputDirectory, METADATA_FILE)
const force = process.argv.includes('--force')

function isUpToDate() {
  if (force || !existsSync(bindingPath) || !existsSync(metadataPath)) return false
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    return metadata.electron === electronVersion && metadata.arch === arch
  } catch {
    return false
  }
}

function build() {
  const sourceDirectory = dirname(runtimeRequire.resolve('better-sqlite3/package.json'))
  const workDirectory = mkdtempSync(join(tmpdir(), 'action-driver-electron-native-'))
  const buildDirectory = join(workDirectory, 'better-sqlite3')
  cpSync(sourceDirectory, buildDirectory, { recursive: true, dereference: true })

  execFileSync(
    'npx',
    [
      '--yes',
      'node-gyp@11',
      'rebuild',
      `--target=${electronVersion}`,
      `--arch=${arch}`,
      '--dist-url=https://electronjs.org/headers'
    ],
    { cwd: buildDirectory, stdio: 'inherit' }
  )

  const builtBinding = join(buildDirectory, 'build', 'Release', BINDING_FILE)
  if (!existsSync(builtBinding)) {
    throw new Error(`node-gyp did not produce ${builtBinding}`)
  }

  mkdirSync(outputDirectory, { recursive: true })
  cpSync(builtBinding, bindingPath)
  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      { electron: electronVersion, arch, builtAt: new Date().toISOString() },
      null,
      2
    )}\n`
  )
}

if (isUpToDate()) {
  console.log(`Electron SQLite binding for Electron ${electronVersion} (${arch}) is up to date.`)
} else {
  console.log(`Building better-sqlite3 for Electron ${electronVersion} (${arch})...`)
  build()
  console.log(`Wrote ${bindingPath}`)
}
