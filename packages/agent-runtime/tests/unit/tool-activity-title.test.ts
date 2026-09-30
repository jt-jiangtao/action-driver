import { describe, expect, it } from 'vitest'
import {
  toolActivityErrorSummary,
  toolActivityResultSummary,
  toolActivitySummary,
  toolActivityTitle
} from '@action-driver/agent-runtime/tool-activity'

describe('tool activity titles', () => {
  it('names the action across the tool lifecycle', () => {
    expect(toolActivityTitle('tools/local/command/shell/run@1', { command: 'cat README.md' }, 'running')).toBe(
      '正在执行命令'
    )
    expect(toolActivityTitle('tools/local/command/shell/run@1', { command: 'cat README.md' }, 'completed')).toBe(
      '已执行命令'
    )
    expect(toolActivityTitle('tools/local/web/search@1', { query: 'Action-Driver' }, 'failed')).toBe(
      '搜索网页“Action-Driver”失败'
    )
  })

  it('names the Computer Use cell instead of a generic tool call', () => {
    expect(toolActivityTitle('tools/local/cua/js', { codeLength: 20 }, 'running')).toBe('正在操作桌面应用')
    expect(toolActivityTitle('tools/local/cua/js', { codeLength: 20 }, 'completed')).toBe('已操作桌面应用')
    expect(toolActivityTitle('tools/local/cua/js', { codeLength: 20 }, 'failed')).toBe('操作桌面应用失败')
    expect(toolActivityTitle('tools/local/cua/reset', {}, 'completed')).toBe('已重置 Computer Use')
    expect(toolActivitySummary('tools/local/cua/js', { codeLength: 20 })).toBe('Computer Use')
    expect(toolActivitySummary('tools/local/cua/reset', {})).toBe('Computer Use 重置')
  })

  it('places Computer Use and Browser Use operation summaries in the title', () => {
    expect(toolActivitySummary('tools/local/cua/js', { title: '获取系统状态', code: 'await cua.getState()' })).toBe('获取系统状态')
    expect(toolActivityTitle('tools/local/cua/js', { title: '获取系统状态' }, 'completed')).toBe('已操作桌面应用：获取系统状态')
  })

  it('titles browser JS cells as Browser Use while retaining the submitted summary', () => {
    const input = { title: '打开测试页面', code: 'await cua.createBrowserTab("iab", "https://example.org")' }
    expect(toolActivitySummary('tools/local/cua/js', input)).toBe('打开测试页面')
    expect(toolActivityTitle('tools/local/cua/js', input, 'completed'))
      .toBe('已操作浏览器：打开测试页面')
    expect(toolActivityTitle('tools/local/cua/js', {
      title: '查看标签页', code: 'await agent.browsers.get("iab")'
    }, 'completed')).toBe('已操作浏览器：查看标签页')
  })

  it('does not include shell arguments in titles', () => {
    expect(
      toolActivityTitle(
        'tools/local/command/shell/run',
        {
          command: 'echo',
          args: ['secret-token']
        },
        'running'
      )
    ).toBe('正在执行命令')
  })

  it('uses runtime-specific titles without putting source code in the row', () => {
    expect(toolActivityTitle('tools/local/command/shell/run', { command: 'echo secret' }, 'running')).toBe(
      '正在执行命令'
    )
    expect(toolActivityTitle('tools/local/command/python/run', { code: 'print("secret")' }, 'completed')).toBe(
      '已运行 Python'
    )
    expect(toolActivityTitle('tools/local/command/node/run', { code: 'console.log("secret")' }, 'failed')).toBe(
      'Node.js 执行失败'
    )
    expect(toolActivityTitle('tools/local/command/python/run', { code: 'x' }, 'cancelled')).toBe(
      '已取消运行 Python'
    )
    expect(
      toolActivityTitle(
        'tools/local/command/typescript/run@2',
        { script: 'const secret: string = "x"' },
        'running'
      )
    ).toBe('正在运行 TypeScript')
  })

  it('names a web page read separately from web search across statuses', () => {
    const input = { url: 'https://example.com/article' }
    expect(toolActivitySummary('tools/local/web/open@1', input)).toBe('读取 example.com')
    expect(toolActivityTitle('tools/local/web/open@1', input, 'running')).toBe('正在读取网页 example.com')
    expect(toolActivityTitle('tools/local/web/open@1', input, 'completed')).toBe('已读取网页 example.com')
    expect(toolActivityTitle('tools/local/web/open@1', input, 'failed')).toBe('读取网页 example.com 失败')
    expect(
      toolActivityResultSummary('tools/local/web/open@1', {
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
