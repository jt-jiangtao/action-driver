import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncComputerUseSkill } from '../../../scripts/sync-codex-cua-skill.mjs'

test('copies the whole Skill with nested resources and removes stale destination files', () => {
  const root = mkdtempSync(join(tmpdir(), 'actiondriver-cua-skill-'))
  try {
    const sourceDirectory = join(root, 'source')
    const documentsDirectory = join(root, 'documents')
    const destinationDirectory = join(root, 'destination')
    mkdirSync(join(sourceDirectory, 'references'), { recursive: true })
    mkdirSync(join(sourceDirectory, 'scripts'), { recursive: true })
    mkdirSync(join(sourceDirectory, 'assets'), { recursive: true })
    mkdirSync(documentsDirectory)
    mkdirSync(destinationDirectory)
    writeFileSync(join(sourceDirectory, 'SKILL.md'), 'old interface\n')
    writeFileSync(join(sourceDirectory, 'references', 'guide.md'), 'nested guide\n')
    writeFileSync(join(sourceDirectory, 'scripts', 'probe.py'), 'print("probe")\n', { mode: 0o755 })
    writeFileSync(join(sourceDirectory, 'assets', 'sample.bin'), Buffer.from([0, 128, 255]))
    writeFileSync(join(documentsDirectory, 'tinysky-alt-core-cua-repl.md'), '## Current CUA\n\nbody unchanged\n')
    writeFileSync(join(documentsDirectory, 'tinysky-alt-confirmations.md'), 'confirmation policy\n')
    writeFileSync(join(destinationDirectory, 'stale.md'), 'obsolete')
    syncComputerUseSkill({ sourceDirectory, documentsDirectory, destinationDirectory })
    assert.equal(readFileSync(join(destinationDirectory, 'references', 'guide.md'), 'utf8'), 'nested guide\n')
    assert.equal(readFileSync(join(destinationDirectory, 'scripts', 'probe.py'), 'utf8'), 'print("probe")\n')
    assert.deepEqual(readFileSync(join(destinationDirectory, 'assets', 'sample.bin')), Buffer.from([0, 128, 255]))
    assert.equal(readFileSync(join(destinationDirectory, 'codex-docs', 'tinysky-alt-confirmations.md'), 'utf8'), 'confirmation policy\n')
    assert.equal(existsSync(join(destinationDirectory, 'stale.md')), false)
    const skill = readFileSync(join(destinationDirectory, 'SKILL.md'), 'utf8')
    assert.ok(skill.includes('tools_local_computer_use_js'))
    assert.ok(skill.endsWith('## Current CUA\n\nbody unchanged\n'))
    assert.equal(readFileSync(join(sourceDirectory, 'SKILL.md'), 'utf8'), 'old interface\n')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('leaves the existing Skill intact when source documentation is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'actiondriver-cua-skill-'))
  try {
    const sourceDirectory = join(root, 'source')
    const documentsDirectory = join(root, 'documents')
    const destinationDirectory = join(root, 'destination')
    mkdirSync(sourceDirectory); mkdirSync(documentsDirectory); mkdirSync(destinationDirectory)
    writeFileSync(join(sourceDirectory, 'SKILL.md'), 'source')
    writeFileSync(join(destinationDirectory, 'SKILL.md'), 'existing')
    assert.throws(() => syncComputerUseSkill({ sourceDirectory, documentsDirectory, destinationDirectory }))
    assert.equal(readFileSync(join(destinationDirectory, 'SKILL.md'), 'utf8'), 'existing')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
