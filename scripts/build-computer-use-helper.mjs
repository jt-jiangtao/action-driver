#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('Computer Use helper requires macOS')
const arch = process.env.ACTIONDRIVER_NATIVE_ARCH?.trim() || process.arch
if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported Computer Use architecture: ${arch}`)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = join(root, 'apps', 'native-computer-use-helper')
const triple = `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx14.0`
const options = ['--package-path', packagePath, '-c', 'release', '--triple', triple]
execFileSync('swift', ['build', ...options], { cwd: root, stdio: 'inherit' })
const binDirectory = execFileSync('swift', ['build', ...options, '--show-bin-path'], {
  cwd: root, encoding: 'utf8'
}).trim()
const source = join(binDirectory, 'actiondriver-computer-use')
const destination = join(packagePath, 'dist', arch, 'actiondriver-computer-use')
mkdirSync(dirname(destination), { recursive: true })
copyFileSync(source, destination)
chmodSync(destination, 0o755)
if (!(statSync(destination).mode & 0o111)) throw new Error('Computer Use helper is not executable')
execFileSync('/usr/bin/file', [destination], { stdio: 'inherit' })

const bundle = join(packagePath, 'dist', arch, 'ActionDriver Computer Use.app')
const executable = join(bundle, 'Contents', 'MacOS', 'actiondriver-computer-use')
mkdirSync(dirname(executable), { recursive: true })
copyFileSync(destination, executable)
chmodSync(executable, 0o755)
const brandSource = join(root, 'apps', 'desktop', 'resources', 'actiondriver.png')
const brandDestination = join(bundle, 'Contents', 'Resources', 'ActionDriver.png')
mkdirSync(dirname(brandDestination), { recursive: true })
copyFileSync(brandSource, brandDestination)

// A real .icns so System Settings and the Dock show the brand instead of a blank app icon.
const iconWork = mkdtempSync(join(tmpdir(), 'actiondriver-icns-'))
const iconset = join(iconWork, 'ActionDriver.iconset')
mkdirSync(iconset, { recursive: true })
for (const size of [16, 32, 64, 128, 256, 512]) {
  execFileSync('sips', ['-z', String(size), String(size), brandSource,
    '--out', join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
  execFileSync('sips', ['-z', String(size * 2), String(size * 2), brandSource,
    '--out', join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
}
const iconDestination = join(bundle, 'Contents', 'Resources', 'ActionDriver.icns')
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', iconDestination], { stdio: 'inherit' })
rmSync(iconWork, { recursive: true, force: true })
writeFileSync(join(bundle, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.actiondriver.computer-use</string>
  <key>CFBundleExecutable</key><string>actiondriver-computer-use</string>
  <key>CFBundleIconFile</key><string>ActionDriver.icns</string>
  <key>CFBundleName</key><string>ActionDriver Computer Use</string>
  <key>CFBundleDisplayName</key><string>ActionDriver Computer Use</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
`)
execFileSync('plutil', ['-lint', join(bundle, 'Contents', 'Info.plist')], { stdio: 'inherit' })
// Development builds must keep a stable TCC identity, otherwise every rebuild invalidates the
// permission the user granted. When no identity is given, fall back to the local development
// keychain if it exists; only then fall back to an ad-hoc signature.
const defaultKeychain = join(homedir(), 'Library', 'Keychains', 'actiondriver-dev.keychain-db')
const keychain = process.env.ACTIONDRIVER_CODESIGN_KEYCHAIN?.trim()
  || (existsSync(defaultKeychain) ? defaultKeychain : undefined)
const identity = process.env.ACTIONDRIVER_CODESIGN_IDENTITY?.trim()
  || (keychain ? 'ActionDriver Dev Signing' : '-')
if (keychain) {
  // Local development identities live in their own keychain, so unlock it before signing.
  execFileSync('security', ['unlock-keychain', '-p',
    process.env.ACTIONDRIVER_CODESIGN_KEYCHAIN_PASSWORD ?? '', keychain], { stdio: 'inherit' })
}
execFileSync('codesign', [
  '--force', '--options', 'runtime',
  ...(keychain ? ['--keychain', keychain] : []),
  '--sign', identity, bundle
], { stdio: 'inherit' })
execFileSync('codesign', ['--verify', '--strict', '--verbose=2', bundle], { stdio: 'inherit' })
