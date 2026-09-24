import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentFileStore } from '../src/agent-files/agent-file-store'

describe('Runtime Agent file ownership', () => {
  it('keeps an existing prompt and Skill definition intact across repeated initialization', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-agent-files-'))
    const first = new AgentFileStore({ homeDirectory })
    await first.initialize()
    const original = await first.getMainPrompt()
    await first.saveFile({ path: original.path, content: '# Custom prompt', expectedDigest: original.digest })
    const second = new AgentFileStore({ homeDirectory })
    await second.initialize()
    expect((await second.getMainPrompt()).content).toBe('# Custom prompt')
    expect((await second.listSkills()).map((skill) => skill.id)).toEqual([
      'browser-tools', 'computer-tools', 'report-writer'
    ])
  })
})
