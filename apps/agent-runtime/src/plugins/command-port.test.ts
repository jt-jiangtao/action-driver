import { expect, it, vi } from 'vitest'
import { createCommandExecutionPort } from './command-port'
import type { InvocationContext } from '@actiondriver/plugin-contracts'
const authority: InvocationContext = { requestId: 'r', callId: 'c', taskId: 'persisted', sessionId: 'session', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [], grants: ['tools.local.command.shell.run@2'] }
it('resolves command workspace from runtime facts and enforces the exact tool grant', async () => {
  const execute = vi.fn(async function* (_call, _signal, context) { yield { kind: 'result' as const, output: context.workspace.root } })
  const resolve = vi.fn(async () => ({ taskId: 'persisted', sessionId: 'session', workspace: { root: '/owned', input: '/owned/input', output: '/owned/output' } }))
  const port = createCommandExecutionPort([{ definition: { id: 'tools.local.command.shell.run', version: 2, modelName: 'tools_local_command_shell_run' }, executor: { execute } }], { resolve })
  const input = { toolId: 'tools.local.command.shell.run', call: { callId: 'forged', providerCallId: 'p', modelName: 'tools_local_command_shell_run', arguments: { script: 'echo yes' }, executionContext: { workspace: { root: '/forged' } } } }
  const events = []
  for await (const event of port.stream(input, authority, new AbortController().signal)) events.push(event)
  expect(events).toEqual([{ kind: 'result', output: '/owned' }])
  expect(resolve).toHaveBeenCalledWith('persisted')
  expect(execute.mock.calls[0]?.[0].callId).toBe('c')
  await expect(port.stream(input, { ...authority, grants: ['tools.local.command.python.run@2'] }, new AbortController().signal).next()).rejects.toThrow('AUTHORIZATION_DENIED')
  await expect(port.stream(input, { ...authority, taskId: undefined } as unknown as InvocationContext, new AbortController().signal).next()).rejects.toThrow('EXECUTION_CONTEXT_UNAVAILABLE')
})
