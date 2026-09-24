import { describe, expect, it } from 'vitest'
import { toolActivityTitle } from '../src/tool-activity'

describe('tool activity titles', () => {
  it('names the action and safe target across the tool lifecycle', () => {
    expect(
      toolActivityTitle('sandbox.fs.read@1', { path: '/workspace/README.md' }, 'running')
    ).toBe('正在读取 README.md')
    expect(
      toolActivityTitle('sandbox.fs.read@1', { path: '/workspace/README.md' }, 'completed')
    ).toBe('已读取 README.md')
    expect(toolActivityTitle('web.search@1', { query: 'ActionDriver' }, 'failed')).toBe(
      '搜索网页“ActionDriver”失败'
    )
  })

  it('does not include shell arguments or a parent directory in titles', () => {
    expect(
      toolActivityTitle(
        'sandbox.shell.run',
        {
          command: 'echo',
          args: ['secret-token']
        },
        'running'
      )
    ).toBe('正在执行命令')
    expect(
      toolActivityTitle(
        'sandbox.fs.read@1',
        {
          path: '/private/secret-folder/README.md'
        },
        'completed'
      )
    ).toBe('已读取 README.md')
  })

  it('uses runtime-specific titles without putting source code in the row', () => {
    expect(toolActivityTitle('local.shell.run', { command: 'echo secret' }, 'running')).toBe('正在执行命令')
    expect(toolActivityTitle('local.python.run', { code: 'print("secret")' }, 'completed')).toBe('已运行 Python')
    expect(toolActivityTitle('local.node.run', { code: 'console.log("secret")' }, 'failed')).toBe('Node.js 执行失败')
    expect(toolActivityTitle('local.python.run', { code: 'x' }, 'cancelled')).toBe('已取消运行 Python')
  })
})
