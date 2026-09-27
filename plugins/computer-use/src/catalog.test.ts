import { expect, it } from 'vitest'
import { catalog } from './catalog'
it('exports original js schemas and computer-use Skill without starting the native runtime', () => {
  expect(catalog.tools.map(tool => tool.modelName)).toEqual(['tools_local_computer_use_js', 'tools_local_computer_use_reset'])
  expect(catalog.tools[0]?.description).toContain('SKILL_NOT_LOADED')
  expect(catalog.skills[0]).toMatchObject({ id: 'computer-use', name: 'computer-use' })
})
