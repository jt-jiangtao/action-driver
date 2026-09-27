import { expect, it, vi } from 'vitest'
import { createSkillStoragePorts } from './skill-port'
it('derives Skill reads from persisted task authority and records only entry reads', async () => {
  const read = vi.fn(async () => ({ path: 'managed/SKILL.md', content: 'content', digest: 'hash', modifiedAt: 'now' }))
  const record = vi.fn()
  const install = vi.fn(async () => { throw new Error('Unexpected') })
  const ports = createSkillStoragePorts({ store: { readEnabledSkillFile: read }, installer: { installSkill: install }, contexts: { async resolve() { return { taskId: 'task', sessionId: 'persisted', workspace: { root: '/session', input: '/session/input', output: '/session/output' } } } }, record })
  const context = { requestId: 'r', callId: 'c', taskId: 'task', sessionId: 'persisted', source: { kind: 'runtime' as const }, chain: [], deadline: Date.now() + 1000 }
  const signal = new AbortController().signal
  await expect(ports['host.skills.read'].invoke({ skillId: 'pdf' }, { ...context, sessionId: 'forged' }, signal)).rejects.toThrow('AUTHORIZATION_DENIED')
  expect(read).not.toHaveBeenCalled()
  expect(await ports['host.skills.read'].invoke({ skillId: 'pdf' }, context, signal)).toEqual({ path: 'managed/SKILL.md', content: 'content' })
  expect(record).toHaveBeenCalledWith('persisted', 'pdf')
  record.mockClear()
  await ports['host.skills.read'].invoke({ skillId: 'pdf', path: 'reference.md' }, context, signal)
  expect(record).not.toHaveBeenCalled()
  await expect(ports['host.skills.install'].invoke({ source: 'local', path: '/outside' }, context, signal)).rejects.toThrow()
  expect(install).not.toHaveBeenCalled()
})
