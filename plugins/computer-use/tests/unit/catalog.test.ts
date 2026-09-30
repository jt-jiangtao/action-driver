import { expect, it } from 'vitest'
import { catalog } from '../../src/catalog'
import { projectToolDetails } from '@action-driver/plugin-sdk'
it('exports original js schemas and computer-use Skill without starting the native runtime', () => {
  expect(catalog.tools.map(tool => tool.modelName)).toEqual(['tools_local_cua_js', 'tools_local_cua_reset'])
  expect(catalog.tools.map(tool => tool.id)).toEqual(['tools/local/cua/js', 'tools/local/cua/reset'])
  expect(catalog.tools[0]?.description).toContain('SKILL_NOT_LOADED')
  expect(catalog.skills[0]).toMatchObject({ id: 'computer-use', name: 'computer-use' })
})
it('presents Computer Use code and output in the script transcript without repeating the title', () => {
  const details = projectToolDetails(catalog.tools[0]?.presentation,
    { title: '获取系统状态', code: 'await cua.getState()' },
    { result: { output: 'Notes is open' } })
  expect(details.layout).toBe('terminal')
  expect(details.input).toEqual([{ label: '执行代码', kind: 'code', language: 'javascript', value: 'await cua.getState()' }])
  expect(details.output).toContainEqual({ label: '执行输出', kind: 'text', value: 'Notes is open' })
})
