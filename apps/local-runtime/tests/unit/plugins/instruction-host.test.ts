import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PluginInstructionHost } from '../../../src/plugins/instruction-host'
import { AgentFileStore } from '../../../src/agent-files/agent-file-store'
it('makes same-package Skill content/resources readable only for the live contribution', async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'action-driver-plugin-skill-'))
  const source = join(homeDirectory, 'package')
  await mkdir(join(source, 'skills/hello'), { recursive: true }); await writeFile(join(source, 'skills/hello/reference.txt'), 'resource')
  const host = new PluginInstructionHost(homeDirectory, ['computer-use'])
  const store = new AgentFileStore({ homeDirectory, pluginSkills: host })
  await store.initialize()
  const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'epoch' }
  const resource = await host.stage(owner, { id: 'fixture.hello', name: 'hello', description: 'Read hello', content: 'Skill instructions', resources: ['skills/hello/reference.txt'] }, source)
  expect((await store.listSkills()).find(skill => skill.id === 'fixture.hello')).toBeUndefined()
  const contribution = host.publish(owner, 'fixture.hello')
  expect((await store.readEnabledSkillFile('fixture.hello')).content).toBe('Skill instructions')
  expect((await store.readEnabledSkillFile('fixture.hello', 'skills/hello/reference.txt')).content).toBe('resource')
  await expect(store.readEnabledSkillFile('fixture.hello', '../package/plugin.json')).rejects.toThrow()
  await contribution.dispose()
  await expect(store.readEnabledSkillFile('fixture.hello')).rejects.toThrow('Skill 未启用')
  await resource.dispose(); await rm(homeDirectory, { recursive: true, force: true })
})
