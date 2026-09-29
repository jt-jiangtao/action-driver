import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createComputerUseEntry } from '../../../src/computer-use/entry'
import { ComputerUseControlGate } from '../../../src/computer-use/control-gate'
import { LoadedSkills } from '../../../src/computer-use/skill-gate'
import { VolatileComputerImages } from '../../../src/computer-use/volatile-images'

function entry(overrides: { cancelTask?: (taskId: string) => Promise<void> } = {}) {
  return createComputerUseEntry({
    runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist'),
    invoke: vi.fn(async () => ({})),
    control: new ComputerUseControlGate(),
    skills: new LoadedSkills(),
    images: new VolatileComputerImages(),
    approvals: {
      isAlwaysAllowed: async () => false,
      persistAlwaysAllowed: async () => {},
      emit: () => {}
    },
    ...overrides
  })
}

describe('Computer Use entry', () => {
  it('offers the model only the Codex js and js_reset tools', async () => {
    const computer = await entry()
    expect(computer.tools.map((tool) => [tool.definition.id, tool.definition.modelName])).toEqual([
      ['tools/local/cua/js', 'tools_local_cua_js'],
      ['tools/local/cua/reset', 'tools_local_cua_reset']
    ])
    await computer.dispose()
  })

  it('states the computer-use Skill prerequisite in the js tool description', async () => {
    const computer = await entry()
    const description =
      computer.tools.find((tool) => tool.definition.modelName === 'tools_local_cua_js')?.definition.description ?? ''
    expect(description).toContain('tools_local_skills_read')
    expect(description).toContain('computer-use')
    expect(description).toContain('SKILL_NOT_LOADED')
    expect(description).toContain('ActionDriver')
    expect(description).toContain('cua.getState()')
    await computer.dispose()
  })

  it('shares one approval broker between the tools and the runtime', async () => {
    const computer = await entry()
    expect(computer.approvals.getPending('task-1')).toEqual([])
    const cancel = vi.spyOn(computer.approvals, 'cancelTask')
    await computer.endTurn('task-1')
    expect(cancel).toHaveBeenCalledWith('task-1')
    await computer.dispose()
  })
})
