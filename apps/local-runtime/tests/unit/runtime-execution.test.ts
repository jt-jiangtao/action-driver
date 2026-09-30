import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRuntimeExecutionEnvironment } from '../../src/runtime-execution'

describe('runtime execution assembly', () => {
  it('creates sandboxed script tools from a workspace root', async () => {
    const result = await createRuntimeExecutionEnvironment({
      runtimeEntry: resolve('apps/local-runtime/src/runtime-process.ts'),
      workspaceRoot: '/tmp/action-driver-execution-test',
      environment: {}
    })
    expect(result.scriptTools.map((tool) => tool.definition.id)).toContain(
      'tools/local/command/shell/run'
    )
    expect(result.runtimeDist).toBe(resolve('apps/local-runtime/dist'))
  })
})
