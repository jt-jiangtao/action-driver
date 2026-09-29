import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { runtimeArtifactFor, verifySha256 } from '../../scripts/stage-runtimes.mjs'

describe('bundled runtime archive lock', () => {
  it('pins both macOS architectures and rejects tampered bytes', () => {
    expect(runtimeArtifactFor('darwin', 'arm64').python.file).toContain('aarch64-apple-darwin')
    expect(runtimeArtifactFor('darwin', 'x64').node.file).toContain('darwin-x64')
    expect(() => runtimeArtifactFor('linux', 'x64')).toThrow('RUNTIME_ARCH_UNSUPPORTED')
    const bytes = Buffer.from('verified')
    expect(() => verifySha256(bytes, createHash('sha256').update(bytes).digest('hex'))).not.toThrow()
    expect(() => verifySha256(Buffer.from('tampered'), '0'.repeat(64))).toThrow('RUNTIME_ARCHIVE_CHECKSUM_MISMATCH')
  })
})
