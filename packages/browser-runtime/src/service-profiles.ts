import { ClassicLevel } from 'classic-level'
import { readFile, cp, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { posix, resolve } from 'node:path'
import type { BackendInfo } from './service-context.js'
interface Profile {
  id: string
  name: string
  isLastUsed: boolean
  orderingIndex: number
  avatarUrl?: string
}
interface LocalState {
  profile: {
    profiles_order: string[]
    info_cache: Record<string, { name: string; avatar_icon?: string }>
    last_used: string
  }
}
const directory: Record<string, string[]> = {
  chrome: ['Google', 'Chrome'],
  edge: ['Microsoft Edge'],
  brave: ['BraveSoftware', 'Brave-Browser'],
  opera: ['com.operasoftware.Opera'],
  vivaldi: ['Vivaldi']
}
export function profileRoot(family: string, platform: string) {
  if (platform !== 'darwin') throw Error(`Unsupported browser profile platform: ${platform}`)
  const parts = directory[family]
  if (!parts) throw Error(`Unknown browser family: ${family}`)
  return posix.resolve(homedir(), 'Library', 'Application Support', ...parts)
}
export async function readProfiles(root: string): Promise<Profile[]> {
  const state = JSON.parse(await readFile(resolve(root, 'Local State'), 'utf8')) as LocalState
  return state.profile.profiles_order.flatMap((id, orderingIndex) => {
    const info = state.profile.info_cache[id]
    return info
      ? [
          {
            id,
            name: info.name,
            isLastUsed: state.profile.last_used === id,
            orderingIndex,
            avatarUrl: info.avatar_icon
          } as Profile
        ]
      : []
  })
}
function hostTmpDir() {
  const host = (globalThis as typeof globalThis & { nodeRepl?: { tmpDir: string } }).nodeRepl
  return host ? host.tmpDir : tmpdir()
}
export async function readExtensionInstanceId(
  root: string,
  profileId: string,
  extensionId: string,
  temp = hostTmpDir()
): Promise<string | null> {
  const source = resolve(root, profileId, 'Local Extension Settings', extensionId)
  if (!existsSync(source)) return null
  const copy = await mkdtemp(resolve(temp, 'codex'))
  let database: ClassicLevel<string, string> | undefined
  try {
    await cp(source, copy, { recursive: true })
    await rm(resolve(copy, 'LOCK'))
    database = new ClassicLevel(copy, {
      createIfMissing: false,
      keyEncoding: 'utf8',
      valueEncoding: 'utf8'
    })
    await database.open()
    const encoded = await database.get('extensionInstanceId')
    if (!encoded) return null
    const instance = JSON.parse(encoded)
    return typeof instance === 'string' ? instance : null
  } finally {
    try {
      await database?.close()
    } finally {
      await rm(copy, { force: true, recursive: true })
    }
  }
}
export async function enrichProfileInfo<T extends BackendInfo>(
  info: T,
  host: { platform: string },
  options: { root?: (family: string, platform: string) => string; tmpDir?: string } = {}
): Promise<T> {
  if (
    info.type !== 'extension' ||
    !info.metadata?.extensionInstanceId ||
    !info.metadata.extensionId
  )
    return info
  const root = (options.root ?? profileRoot)(info.family ?? 'chrome', host.platform),
    profiles = await readProfiles(root),
    identified = await Promise.all(
      profiles.map(async (profile) => {
        try {
          return {
            ...profile,
            instance: await readExtensionInstanceId(
              root,
              profile.id,
              String(info.metadata!.extensionId),
              options.tmpDir
            )
          }
        } catch {
          return { ...profile, instance: null }
        }
      })
    ),
    match = identified.find((profile) => profile.instance === info.metadata?.extensionInstanceId)
  return match
    ? {
        ...info,
        metadata: {
          ...info.metadata,
          profileName: match.name,
          profileIsLastUsed: match.isLastUsed.toString(),
          profileOrdering: match.orderingIndex.toString()
        }
      }
    : info
}
