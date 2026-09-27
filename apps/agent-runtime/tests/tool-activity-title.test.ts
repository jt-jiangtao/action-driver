import { describe, expect, it } from 'vitest'
import {
  toolActivityErrorSummary,
  toolActivityResultSummary,
  toolActivitySummary,
  toolActivityTitle
} from '../src/tool-activity'

describe('tool activity titles', () => {
  it('names the action across the tool lifecycle', () => {
    expect(toolActivityTitle('local.shell.run@1', { command: 'cat README.md' }, 'running')).toBe(
      '正在执行命令'
    )
    expect(toolActivityTitle('local.shell.run@1', { command: 'cat README.md' }, 'completed')).toBe(
      '已执行命令'
    )
    expect(toolActivityTitle('web.search@1', { query: 'ActionDriver' }, 'failed')).toBe(
      '搜索网页“ActionDriver”失败'
    )
  })

  it('names the Computer Use cell instead of a generic tool call', () => {
    expect(toolActivityTitle('computer.js', { codeLength: 20 }, 'running')).toBe('正在操作桌面应用')
    expect(toolActivityTitle('computer.js', { codeLength: 20 }, 'completed')).toBe('已操作桌面应用')
    expect(toolActivityTitle('computer.js', { codeLength: 20 }, 'failed')).toBe('操作桌面应用失败')
    expect(toolActivityTitle('computer.js_reset', {}, 'completed')).toBe('已重置 Computer Use')
    expect(toolActivitySummary('computer.js', { codeLength: 20 })).toBe('Computer Use')
    expect(toolActivitySummary('computer.js_reset', {})).toBe('Computer Use 重置')
  })

  it('does not include shell arguments in titles', () => {
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
  })

  it('uses runtime-specific titles without putting source code in the row', () => {
    expect(toolActivityTitle('local.shell.run', { command: 'echo secret' }, 'running')).toBe(
      '正在执行命令'
    )
    expect(toolActivityTitle('local.python.run', { code: 'print("secret")' }, 'completed')).toBe(
      '已运行 Python'
    )
    expect(toolActivityTitle('local.node.run', { code: 'console.log("secret")' }, 'failed')).toBe(
      'Node.js 执行失败'
    )
    expect(toolActivityTitle('local.python.run', { code: 'x' }, 'cancelled')).toBe(
      '已取消运行 Python'
    )
    expect(
      toolActivityTitle(
        'local.typescript.run@2',
        { script: 'const secret: string = "x"' },
        'running'
      )
    ).toBe('正在运行 TypeScript')
  })

  it('names a web page read separately from web search across statuses', () => {
    const input = { url: 'https://example.com/article' }
    expect(toolActivitySummary('web.open@1', input)).toBe('读取 example.com')
    expect(toolActivityTitle('web.open@1', input, 'running')).toBe('正在读取网页 example.com')
    expect(toolActivityTitle('web.open@1', input, 'completed')).toBe('已读取网页 example.com')
    expect(toolActivityTitle('web.open@1', input, 'failed')).toBe('读取网页 example.com 失败')
    expect(
      toolActivityResultSummary('web.open@1', {
        result: { title: '页面标题', url: input.url, text: '正文', truncated: false }
      })
    ).toBe('页面标题')
  })

  it('shows a useful reason when a webpage cannot be read', () => {
    expect(
      toolActivityErrorSummary({
        code: 'TOOL_EXECUTION_FAILED',
        message: 'WEB_OPEN_URL_DENIED'
      })
    ).toBe('仅支持公网网页')
    expect(
      toolActivityErrorSummary({
        code: 'TOOL_EXECUTION_FAILED',
        message: 'WEB_OPEN_CONTENT_UNSUPPORTED'
      })
    ).toBe('该页面不是 HTML')
    expect(
      toolActivityErrorSummary({
        code: 'TOOL_EXECUTION_FAILED',
        message: 'WEB_OPEN_EMPTY_CONTENT'
      })
    ).toBe('网页没有可读取的正文')
  })
})
