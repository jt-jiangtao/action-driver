export type RuntimeArtifact = { file: string; url: string; sha256: string }
export function runtimeArtifactFor(platform: string, arch: string): {
  python: RuntimeArtifact
  node: RuntimeArtifact
}
export function verifySha256(bytes: Uint8Array, expected: string): void
export function stageRuntime(kind: 'python' | 'node', artifact: RuntimeArtifact, target: string): Promise<void>
