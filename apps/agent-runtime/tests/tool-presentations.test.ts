import { expect, it } from 'vitest'

it('publishes semantic presentation for all twelve builtins through standalone package exports', async () => {
  const standalone = await import('@actiondriver/command-plugin/presentation')
  expect(Object.keys(standalone.presentations)).toHaveLength(5)
  const packages = ['command', 'web', 'skills', 'image-generation', 'computer-use']
  const tools = []
  for (const name of packages) {
    const { catalog } = await import(`@actiondriver/${name}-plugin/catalog`)
    expect(catalog.tools.every((tool: { presentation?: unknown }) => tool.presentation)).toBe(true)
    const { presentations } = await import(`@actiondriver/${name}-plugin/presentation`)
    for (const tool of catalog.tools) {
      expect(tool.presentation).toEqual(presentations[tool.id])
      expect(tool.presentation.output.length).toBeGreaterThan(0)
      expect(tool.presentation.output.every((field: { path: string }) => field.path !== 'result')).toBe(true)
      tools.push(tool)
    }
  }
  expect(tools).toHaveLength(12)
})

it('extracts real builtin result fields and keeps command streams and validated assets distinct', async () => {
  const { projectToolDetails } = await import('@actiondriver/plugin-sdk')
  const { presentations: command } = await import('@actiondriver/command-plugin/presentation')
  const { presentations: web } = await import('@actiondriver/web-plugin/presentation')
  const { presentations: skills } = await import('@actiondriver/skills-plugin/presentation')
  const { presentations: image } = await import('@actiondriver/image-generation-plugin/presentation')
  const { presentations: computer } = await import('@actiondriver/computer-use-plugin/presentation')
  const project = (metadata: Parameters<typeof projectToolDetails>[0], input: unknown, output: unknown) => projectToolDetails(metadata, input, output)
  expect(project(command['tools.local.command.node.run'], { script: 'console.log(0)', args: ['a'] }, { stdout: '0', stderr: 'warning', result: { exitCode: 0 } }).output.map(field => field.value)).toEqual(['0', 'warning', '0'])
  expect(project(command['tools.local.command.node.run'], {}, { result: { exitCode: 0 } }).output[0]).toMatchObject({ value: '0', placement: 'footer' })
  expect(project(command['tools.local.command.dependencies.load'], {}, { result: { RUNTIME_NODE: '/node', RUNTIME_NODE_MODULES: '/modules', RUNTIME_BIN_DIR: '/bin', RUNTIME_PYTHON: '/python' } }).output.map(field => field.value)).toEqual(['/node', '/modules', '/bin', '/python'])
  expect(project(web['tools.local.web.search'], { query: 'q' }, { result: { results: [{ title: 'Title', url: 'https://example.com', snippet: 'Summary' }], totalResults: 1, truncated: false } }).output.map(field => field.value)).toEqual(['Title', 'https://example.com', 'Summary', '1'])
  expect(project(web['tools.local.web.open'], {}, { result: { title: 'Page', url: 'https://example.com', text: 'Body' } }).output.map(field => field.value)).toEqual(['Page', 'https://example.com', 'Body'])
  expect(project(skills['tools.local.skills.read'], {}, { result: { skillId: 'pdf', path: 'SKILL.md', content: 'Instructions' } }).output.map(field => field.value)).toEqual(['pdf', 'SKILL.md', 'Instructions'])
  expect(project(skills['tools.local.skills.install'], {}, { result: { name: 'Example', id: 'example', source: 'local', enabled: false, available: true } }).output.map(field => field.value)).toEqual(['Example', 'example', 'local', 'false', 'true'])
  const asset = { assetId: 'a', sessionId: 's', mimeType: 'image/png', width: 1, height: 1, byteLength: 1, source: 'generated' }
  const detail = project(image['tools.local.image-generation.generate'], { images: [{ prompt: 'A landscape' }] }, { result: { succeeded: 1, failed: 0 }, assets: [asset, '/unsafe.png'] })
  expect(detail.input[0]?.value).toBe('A landscape')
  expect(detail.output.map(field => field.kind)).toEqual(['text', 'text', 'image'])
  expect(detail.output[2]?.asset).toEqual(asset)
  expect(project(computer['tools.local.computer-use.js'], { codeLength: 20 }, { result: { output: 'Done' } }).output[0]?.value).toBe('Done')
  expect(project(computer['tools.local.computer-use.reset'], {}, { result: { reset: true } }).output[0]?.value).toBe('true')
})

it('places each command exit code in the generic details footer', async () => {
  const { presentations } = await import('@actiondriver/command-plugin/presentation')
  for (const language of ['shell', 'python', 'node', 'typescript']) {
    const fields = presentations[`tools.local.command.${language}.run`]!.output
    expect(fields.find(field => field.path === 'result.exitCode')).toMatchObject({ placement: 'footer' })
    expect(fields.filter(field => field.path !== 'result.exitCode').every(field => field.placement === undefined)).toBe(true)
  }
})

it('declares terminal layout only for the four command runners', async () => {
  const { presentations } = await import('@actiondriver/command-plugin/presentation')
  for (const language of ['shell', 'python', 'node', 'typescript']) {
    expect(presentations[`tools.local.command.${language}.run`]).toMatchObject({ layout: 'terminal' })
  }
  expect(presentations['tools.local.command.dependencies.load']?.layout).toBeUndefined()
})
