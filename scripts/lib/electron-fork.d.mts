export interface ElectronForkProvenance {
  schemaVersion: number
  platform: string
  arch: string
  version: string
  chromiumVersion: string
  repo: string
  sourceCommit: string
  chromiumCommit: string
  chromiumBaseCommit: string
  buildArgs: string
  buildArgsSha256: string
  appPath: string
  executableRelativePath: string
  executableSha256: string
  appSha256: string
}
export function resolveElectronFork(options?: {
  projectRoot?: string
  platform?: string
  arch?: string
}): Promise<{ executablePath: string; appPath: string; provenance: ElectronForkProvenance }>
export function sha256(file: string): Promise<string>
export function sha256Tree(root: string): Promise<string>
