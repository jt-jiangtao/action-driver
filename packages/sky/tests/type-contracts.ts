import type { MacComputerUseClient } from '../src/mac/client.js'
type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Result<K extends keyof MacComputerUseClient> = MacComputerUseClient[K] extends (
  ...args: never[]
) => infer R
  ? Awaited<R>
  : never
export type Checks = [
  Assert<Equal<Result<'click'>, void>>,
  Assert<Equal<Result<'pressKey'>, void>>,
  Assert<Equal<Result<'startAudioRecording'>, void>>,
  Assert<Result<'listApps'> extends Array<{ displayName?: string }> ? true : false>,
  Assert<
    Result<'getAppState'> extends { app: string | { pid?: number; bundleIdentifier?: string } }
      ? true
      : false
  >,
  Assert<
    Result<'getAppPolicy'> extends { decision: 'allowed' | 'denied' | 'forbidden' } ? true : false
  >
]
