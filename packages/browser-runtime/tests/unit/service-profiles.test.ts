// @vitest-environment node
import { test, expect } from 'vitest'
import { mkdtemp, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClassicLevel } from 'classic-level'
import {
  readProfiles,
  readExtensionInstanceId,
  enrichProfileInfo,
  profileRoot
} from '../../src/service-profiles'
import { originalDocumentation } from '../original-service'
test('profile Local State ordering, missing cache entries and fields match baseline', async () => {
  const base = await originalDocumentation(),
    root = await mkdtemp(join(tmpdir(), 'cua-profile-'))
  try {
    await writeFile(
      join(root, 'Local State'),
      JSON.stringify({
        profile: {
          profiles_order: ['Profile 1', 'missing', 'Default'],
          info_cache: {
            Default: { name: 'Default', avatar_icon: 'avatar' },
            'Profile 1': { name: 'Work' }
          },
          last_used: 'Profile 1'
        }
      })
    )
    expect(await readProfiles(root)).toEqual(await base.baselineReadProfiles(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('macOS profile roots match original registry and reject non-mac platform', async () => {
  const base = await originalDocumentation()
  for (const family of ['chrome', 'edge', 'brave', 'opera', 'vivaldi'])
    expect(profileRoot(family, 'darwin')).toBe(base.baselineProfileRoot(family, 'darwin'))
  expect(() => profileRoot('chrome', 'linux')).toThrow('Unsupported browser profile platform')
})
test('extension instance reader opens a copied database and always removes the temporary copy', async () => {
  const base = await originalDocumentation(),
    root = await mkdtemp(join(tmpdir(), 'cua-profiles-')),
    temp = await mkdtemp(join(tmpdir(), 'cua-profile-copies-'))
  try {
    const path = join(root, 'Default', 'Local Extension Settings', 'extension')
    await mkdir(path, { recursive: true })
    const database = new ClassicLevel(path, { keyEncoding: 'utf8', valueEncoding: 'utf8' })
    await database.open()
    await database.put('extensionInstanceId', JSON.stringify('instance'))
    await database.close()
    const baseline = base.createBaselineProfileTools(root, temp)
    expect(await readExtensionInstanceId(root, 'Default', 'extension', temp)).toBe(
      await baseline.readInstance(root, 'Default', 'extension')
    )
    expect(await readdir(temp)).toEqual([])
    expect(await readExtensionInstanceId(root, 'missing', 'extension', temp)).toBe(null)
    const reopen = new ClassicLevel(path, { keyEncoding: 'utf8', valueEncoding: 'utf8' })
    await reopen.open()
    expect(await reopen.get('extensionInstanceId')).toBe('"instance"')
    await reopen.close()
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(temp, { recursive: true, force: true })
  }
})
test('profile metadata enrichment preserves unrelated fields and uses string ordering flags', async () => {
  const base = await originalDocumentation(),
    root = await mkdtemp(join(tmpdir(), 'cua-profiles-')),
    temp = await mkdtemp(join(tmpdir(), 'cua-profile-copies-'))
  try {
    await writeFile(
      join(root, 'Local State'),
      JSON.stringify({
        profile: {
          profiles_order: ['Default'],
          info_cache: { Default: { name: 'Work' } },
          last_used: 'Default'
        }
      })
    )
    const path = join(root, 'Default', 'Local Extension Settings', 'extension')
    await mkdir(path, { recursive: true })
    const database = new ClassicLevel(path, { keyEncoding: 'utf8', valueEncoding: 'utf8' })
    await database.open()
    await database.put('extensionInstanceId', '"instance"')
    await database.close()
    const info = {
        type: 'extension',
        metadata: { extensionId: 'extension', extensionInstanceId: 'instance', extra: 'retained' }
      },
      baseline = base.createBaselineProfileTools(root, temp)
    expect(
      await enrichProfileInfo(info, { platform: 'darwin' }, { root: () => root, tmpDir: temp })
    ).toEqual(await baseline.enrich(info, { platform: 'darwin' }))
    const other = { type: 'iab' }
    expect(await enrichProfileInfo(other, { platform: 'darwin' })).toBe(other)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(temp, { recursive: true, force: true })
  }
})
