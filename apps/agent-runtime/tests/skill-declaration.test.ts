import { describe, expect, it } from 'vitest'
import { parseSkillDeclaration } from '../src/agent-files/skill-declaration'

describe('Skill declaration', () => {
  it('parses metadata without requiring an executor', () => {
    expect(parseSkillDeclaration('---\nname: Plain\ndescription: Helps\n---\n# Body')).toMatchObject({
      name: 'Plain', description: 'Helps', executorId: null
    })
  })

  it('keeps legacy markdown without frontmatter usable', () => {
    expect(parseSkillDeclaration('# Legacy\n\nFirst paragraph.\n')).toMatchObject({
      name: 'Legacy', description: 'First paragraph.', executorId: null
    })
  })

  it('rejects malformed YAML rather than accepting an incomplete declaration', () => {
    expect(() => parseSkillDeclaration('---\nname: [broken\n---\n# Body')).toThrow()
  })
})
