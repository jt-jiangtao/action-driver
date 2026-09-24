import { SandboxPathGuard } from './path-guard'
import { createSandboxFileTools } from './file-tools'

export { SandboxPathGuard } from './path-guard'
export { createSandboxFileTools } from './file-tools'

export async function createSandboxTools(options: { workspaceRoot: string }) {
  const guard = await SandboxPathGuard.create(options.workspaceRoot)
  const files = createSandboxFileTools(guard, { maxReadBytes: 1024 * 1024 - 4096 })
  return [files.list, files.read]
}
