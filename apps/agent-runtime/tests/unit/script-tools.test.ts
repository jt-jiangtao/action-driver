import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolCall, ToolExecutionContext } from '@action-driver/runtime-contracts'
import { createScriptTools } from '../../src/execution/tools'
import { SessionSandbox } from '../../src/execution/session-sandbox'
import { z } from 'zod'

function sessionContext(workspaceRoot: string, sessionId = 'session-1'): ToolExecutionContext {
  return {
    taskId: 'task-1',
    sessionId,
    workspace: {
      root: join(workspaceRoot, 'sessions', sessionId),
      input: join(workspaceRoot, 'sessions', sessionId, 'input'),
      output: join(workspaceRoot, 'sessions', sessionId, 'output')
    }
  }
}

async function sessionWorkspaceRoot(prefix: string): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(workspaceRoot, 'sessions', 'session-1', 'input'), { recursive: true })
  await mkdir(join(workspaceRoot, 'sessions', 'session-1', 'output'), { recursive: true })
  return workspaceRoot
}

async function collect(
  tool: Awaited<ReturnType<typeof createScriptTools>>[number],
  args: Record<string, unknown>,
  workspaceRoot: string
) {
  const call: ToolCall = {
    callId: 'test', providerCallId: 'provider-test', modelName: tool.definition.modelName,
    arguments: args as ToolCall['arguments']
  }
  const events = []
  for await (const event of tool.executor.execute(call, undefined, sessionContext(workspaceRoot))) events.push(event)
  return events
}

describe('independent script tools', () => {
  it('exposes only complete bundled office dependency paths to shell scripts', async () => {
    const runtimeDist = await mkdtemp(join(tmpdir(), 'action-driver-office-env-'))
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'action-driver-office-workspace-'))
    const rg = join(runtimeDist, 'bin', 'rg')
    await mkdir(join(rg, '..'), { recursive: true })
    await writeFile(rg, '#!/bin/sh\n')
    await chmod(rg, 0o755)
    const bundledRuntime = join(process.cwd(), 'apps/agent-runtime/dist')
    const tools = await createScriptTools({
      runtimeDist,
      // The fixture links its interpreters back into the real bundle, so both
      // trees must be readable inside the sandbox.
      sandbox: new SessionSandbox({ runtimeRoots: [runtimeDist, bundledRuntime] })
    })
    const shell = tools.find((tool) => tool.definition.modelName === 'tools_local_command_shell_run')!
    const script = 'printf "%s\\n" "${RUNTIME_NODE-unset}"'
    expect(JSON.stringify(await collect(shell, { script }, workspaceRoot))).toContain('unset')
    for (const relative of [
      'dependencies/node/bin/node', 'dependencies/python/bin/python3',
      'dependencies/bin/override/soffice', 'dependencies/bin/override/pdftoppm'
    ]) {
      const file = join(runtimeDist, relative)
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(file, '#!/bin/sh\n')
      await chmod(file, 0o755)
    }
    await mkdir(join(runtimeDist, 'dependencies/node/node_modules'))
    const output = JSON.stringify(await collect(shell, {
      script: 'printf "%s\\n" "$RUNTIME_NODE" "$RUNTIME_NODE_MODULES" "$RUNTIME_BIN_DIR" "$RUNTIME_PYTHON" "$PATH"'
    }, workspaceRoot))
    for (const relative of [
      'dependencies/node/bin/node', 'dependencies/node/node_modules',
      'dependencies/bin/override', 'dependencies/python/bin/python3'
    ]) expect(output).toContain(join(runtimeDist, relative))
    expect(output).toContain([
      join(runtimeDist, 'dependencies/bin/override'),
      join(runtimeDist, 'runtimes', `darwin-${process.arch}`, 'python', 'bin'),
      join(runtimeDist, 'runtimes', `darwin-${process.arch}`, 'node', 'bin'),
      join(runtimeDist, 'bin'), '/usr/bin', '/bin'
    ].join(':'))

    const bundled = join(process.cwd(), 'apps/agent-runtime/dist/runtimes', `darwin-${process.arch}`)
    for (const name of ['node', 'python'] as const) {
      const binary = name === 'node' ? 'node' : 'python3'
      const link = join(runtimeDist, 'runtimes', `darwin-${process.arch}`, name, 'bin', binary)
      await mkdir(join(link, '..'), { recursive: true })
      await symlink(join(bundled, name, 'bin', binary), link)
    }
    for (const name of ['tools_local_command_python_run', 'tools_local_command_node_run', 'tools_local_command_typescript_run']) {
      const tool = tools.find((candidate) => candidate.definition.modelName === name)!
      const script = name === 'tools_local_command_python_run'
        ? 'import os; print(os.environ["RUNTIME_PYTHON"], os.environ["RUNTIME_NODE"], os.environ["RUNTIME_BIN_DIR"], os.environ["RUNTIME_NODE_MODULES"])'
        : 'console.log(process.env.RUNTIME_PYTHON, process.env.RUNTIME_NODE, process.env.RUNTIME_BIN_DIR, process.env.RUNTIME_NODE_MODULES)'
      const result = JSON.stringify(await collect(tool, { script }, workspaceRoot))
      expect(result).toContain(join(runtimeDist, 'dependencies/python/bin/python3'))
      expect(result).toContain(join(runtimeDist, 'dependencies/node/bin/node'))
    }
  })

  it('runs shell syntax, Python standard library and Node built-ins from bundled paths', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('action-driver-tools-')
    const tools = await createScriptTools({ runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    expect(tools.map((tool) => tool.definition.modelName)).toEqual(['tools_local_command_shell_run', 'tools_local_command_python_run', 'tools_local_command_node_run', 'tools_local_command_typescript_run'])
    expect(tools.map((tool) => tool.definition.timeoutMs)).toEqual([120_000, 120_000, 120_000, 120_000])
    const shell = tools[0]!
    const python = tools[1]!
    const node = tools[2]!
    const ts = tools[3]!
    expect(JSON.stringify(await collect(shell, { script: 'printf needle | rg needle' }, workspaceRoot))).toContain('needle')
    expect(JSON.stringify(await collect(shell, { script: 'printf needle > output/redirected.txt && rg needle output/redirected.txt' }, workspaceRoot))).toContain('needle')
    const py = JSON.stringify(await collect(python, { script: 'import json,sys; print(json.dumps({"executable":sys.executable}))' }, workspaceRoot))
    expect(py).toContain('/dist/runtimes/darwin-')
    const js = JSON.stringify(await collect(node, { script: "console.log(require('node:fs') !== undefined, process.execPath)" }, workspaceRoot))
    expect(js).toContain('/dist/runtimes/darwin-')
    expect(JSON.stringify(await collect(python, { script: 'import sys; print(sys.argv[1])', args: ['argument'] }, workspaceRoot))).toContain('argument')
    expect(JSON.stringify(await collect(node, { script: 'console.log(process.argv[2])', args: ['argument'] }, workspaceRoot))).toContain('argument')
    expect(JSON.stringify(await collect(ts, { script: 'const value: string = "typed"; console.log(value)' }, workspaceRoot))).toContain('typed')
  })

  it('rejects ambiguous script input before spawning', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'action-driver-tools-invalid-'))
    const tools = await createScriptTools({ runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    for (const tool of tools) {
      const schema = z.fromJSONSchema(tool.definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
      expect(schema.safeParse({}).success).toBe(false)
      expect(schema.safeParse({ code: 'x' }).success).toBe(false)
      expect(schema.safeParse({ file: 'x' }).success).toBe(false)
      expect(schema.safeParse({ command: 'x' }).success).toBe(false)
      expect(schema.safeParse({ script: 'x' }).success).toBe(true)
      await expect(collect(tool, {}, workspaceRoot)).rejects.toThrow('TOOL_INPUT_INVALID')
      await expect(collect(tool, { script: ' ' }, workspaceRoot)).rejects.toThrow('TOOL_INPUT_INVALID')
    }
  })

  it('reports unsupported TypeScript syntax without invoking a system compiler', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'action-driver-tools-ts-'))
    const tools = await createScriptTools({ runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    const ts = tools.find((tool) => tool.definition.modelName === 'tools_local_command_typescript_run')!
    await expect(collect(ts, { script: 'enum Color { Red }\nconsole.log(Color.Red)' }, workspaceRoot))
      .rejects.toThrow('PROCESS_EXIT_NONZERO')
  })

  it('starts every script in the session workspace it was given', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('action-driver-session-workspace-')
    const physicalRoot = await realpath(join(workspaceRoot, 'sessions', 'session-1'))
    const tools = await createScriptTools({ runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    for (const tool of tools) {
      const script = tool.definition.modelName === 'tools_local_command_shell_run'
        ? 'pwd -P'
        : tool.definition.modelName === 'tools_local_command_python_run'
          ? 'import os; print(os.getcwd())'
          : 'console.log(process.cwd())'
      const output = JSON.stringify(
        await collect(tool, { script }, workspaceRoot)
      )
      expect(output).toContain(physicalRoot)
    }
  })

  it('refuses to run without a trusted execution context', async () => {
    const tools = await createScriptTools({ runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    const call: ToolCall = {
      callId: 'test',
      providerCallId: 'provider-test',
      modelName: 'tools_local_command_shell_run',
      arguments: { script: 'true' }
    }
    await expect(async () => {
      // The tool must not produce any event without a session context.
      for await (const _ignored of tools[0]!.executor.execute(call)) void _ignored
    }).rejects.toThrow('EXECUTION_CONTEXT_UNAVAILABLE')
  })

  it('blocks cross-session reads even when a script asks for the absolute path', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('action-driver-sandbox-cross-')
    const otherSession = join(workspaceRoot, 'sessions', 'session-2', 'output')
    await mkdir(otherSession, { recursive: true })
    await writeFile(join(otherSession, 'secret.txt'), 'other-session-bytes')
    const tools = await createScriptTools({ runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    const shell = tools[0]!
    const script = `cat ${join(otherSession, 'secret.txt')}`

    const failure = await collect(shell, { script }, workspaceRoot).then(
      () => null,
      (error: unknown) => error
    )
    expect(failure).toBeInstanceOf(Error)
    expect(JSON.stringify(failure)).not.toContain('other-session-bytes')
  })

  it('fails closed when the platform cannot establish a session sandbox', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('action-driver-sandbox-closed-')
    const tools = await createScriptTools({
      runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist'),
      sandbox: new SessionSandbox({
        runtimeRoots: [join(process.cwd(), 'apps/agent-runtime/dist')],
        platform: 'linux'
      })
    })

    await expect(collect(tools[0]!, { script: 'true' }, workspaceRoot)).rejects.toThrow(
      'SANDBOX_UNAVAILABLE'
    )
  })
})
