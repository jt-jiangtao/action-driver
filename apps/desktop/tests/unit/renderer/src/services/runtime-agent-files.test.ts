import { describe, expect, it, vi } from 'vitest'
import { RuntimeAgentFilesService } from '../../../../../src/renderer/src/services/runtime-agent-files'
import type { RuntimeHttpClient } from '../../../../../src/renderer/src/services/runtime-http-client'

describe('RuntimeAgentFilesService', () => {
  it('maps prompt and Skill operations to Runtime routes', async () => {
    const request = vi.fn(async () => [])
    const files = new RuntimeAgentFilesService({ request } as unknown as RuntimeHttpClient)
    await files.getMainPrompt()
    await files.listSkills()
    await files.installSkill({ source: 'github', url: 'https://github.com/acme/tools/tree/main/writer' })
    await files.saveFile({ path: '.action-driver/prompts/main.md', content: '# New', expectedDigest: 'old' })
    expect(request.mock.calls).toEqual([
      ['/agent-files/main-prompt'],
      ['/agent-files/skills'],
      ['/agent-files/skills/install', { method: 'POST', body: { source: 'github', url: 'https://github.com/acme/tools/tree/main/writer' } }],
      ['/agent-files/file', { method: 'POST', body: {
        path: '.action-driver/prompts/main.md', content: '# New', expectedDigest: 'old'
      } }]
    ])
  })
})
