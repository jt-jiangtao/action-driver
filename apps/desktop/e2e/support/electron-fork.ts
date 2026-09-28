import { resolveElectronFork } from '../../../../scripts/lib/electron-fork.mjs'
let artifact: ReturnType<typeof resolveElectronFork> | undefined
export async function getElectronForkExecutable(): Promise<string> {
  artifact ??= resolveElectronFork()
  return (await artifact).executablePath
}
