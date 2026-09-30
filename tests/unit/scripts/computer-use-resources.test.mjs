import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyComputerUseResources } from '../../../scripts/computer-use-resources.mjs'

test('copies the Swift resource bundle and removes obsolete generated resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'helper-resources-'))
  try {
    const bundle = 'ProductComputerUse_ComputerUseCore.bundle'
    const source = join(root, 'build'),
      destination = join(root, 'app', 'Contents', 'Resources')
    const nested = join(bundle, 'Contents', 'Resources', 'app-instructions.json')
    mkdirSync(join(source, bundle, 'Contents', 'Resources'), { recursive: true })
    mkdirSync(join(destination, bundle), { recursive: true })
    writeFileSync(join(source, nested), '{"com.apple.finder":"guidance"}')
    writeFileSync(join(destination, bundle, 'obsolete'), 'old')
    copyComputerUseResources(source, destination)
    assert.equal(readFileSync(join(destination, nested), 'utf8'), '{"com.apple.finder":"guidance"}')
    assert.equal(existsSync(join(destination, bundle, 'obsolete')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('missing build resources fail before removing existing resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'helper-resources-'))
  try {
    const destination = join(root, 'destination')
    mkdirSync(destination)
    writeFileSync(join(destination, 'keep'), 'existing')
    assert.throws(
      () => copyComputerUseResources(join(root, 'missing'), destination),
      /resource bundle/i
    )
    assert.equal(readFileSync(join(destination, 'keep'), 'utf8'), 'existing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
