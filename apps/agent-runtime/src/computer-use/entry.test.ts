import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createComputerUseEntry } from './entry'
import { ComputerUseControlGate } from './control-gate'
import { LoadedSkills } from './skill-gate'
import { VolatileComputerImages } from './volatile-images'

const vendorRoot = join(process.cwd(), 'apps/agent-runtime/vendor/codex-cua')

function entry(overrides: { cancelTask?: (taskId: string) => Promise<void> } = {}) {
  return createComputerUseEntry({
    runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist'),
    vendorRoot,
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
      ['computer.js', 'js'],
      ['computer.js_reset', 'js_reset']
    ])
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
