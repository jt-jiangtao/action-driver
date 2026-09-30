import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ToolInvocationProjection } from '@action-driver/contracts'
import { ActivityItems, ToolRow } from '../../../../../../src/renderer/src/components/agent/ToolGroup'
const tool = (extra: Record<string, unknown>): ToolInvocationProjection => ({
  callId: 'c',
  toolId: 'tools/cloud/example/lookup',
  modelName: 'example',
  summary: '已查询目标',
  argumentsHash: '',
  status: 'completed',
  ...extra
})
describe('unified semantic tool details', () => {
  it('renders a third-party tool using labeled fields without renderer-specific branches', () => {
    render(
      <ToolRow
        tool={tool({
          details: {
            input: [{ label: '查询目标', kind: 'text', value: '客户 A' }],
            output: [
              { label: '状态', kind: 'text', value: 'false' },
              { label: '数量', kind: 'text', value: '0' }
            ]
          }
        })}
      />
    )
    fireEvent.click(screen.getAllByText('已查询目标')[0]!)
    expect(screen.getByText('查询目标')).toBeVisible()
    expect(screen.getByText('客户 A')).toBeVisible()
    expect(screen.getByText('false')).toBeVisible()
    expect(screen.getByText('0')).toBeVisible()
    expect(screen.getByRole('region', { name: '工具详情' })).toHaveStyle({
      maxHeight: '640px',
      overflowY: 'auto'
    })
  })
  it('never dumps unknown raw JSON as a fallback', () => {
    render(
      <ToolRow
        tool={tool({
          rawInput: '{"credential":"secret","deep":{"x":1}}',
          rawOutput: '{"transport":"internal","result":{"unfamiliar":2}}'
        })}
      />
    )
    fireEvent.click(screen.getAllByText('已查询目标')[0]!)
    expect(screen.queryByText(/credential|secret|transport|unfamiliar/)).toBeNull()
    expect(screen.getByText('摘要')).toBeVisible()
  })
  it('opens safe links through the desktop interface and keeps unsafe links inert', () => {
    const open = vi.fn(async () => {})
    vi.stubGlobal('productDesktop', { externalLinks: { open } })
    render(
      <ToolRow
        tool={tool({
          details: {
            input: [],
            output: [
              { label: '来源', kind: 'link', value: 'https://example.com/page' },
              { label: '无效来源', kind: 'link', value: 'javascript:alert(1)' }
            ]
          }
        })}
      />
    )
    fireEvent.click(screen.getAllByText('已查询目标')[0]!)
    fireEvent.click(screen.getByRole('link', { name: 'https://example.com/page' }))
    expect(open).toHaveBeenCalledWith('https://example.com/page')
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull()
    vi.unstubAllGlobals()
  })
})

it('uses positional sections and pins a declared exit code to the bottom-right footer', () => {
  const { container } = render(
    <ToolRow
      tool={tool({
        details: {
          input: [{ label: '脚本', kind: 'code', value: 'echo ok' }],
          output: [
            { label: '标准输出', kind: 'text', value: 'ok' },
            { label: '退出码', kind: 'text', value: '0', placement: 'footer' }
          ]
        }
      })}
    />
  )
  fireEvent.click(screen.getAllByText('已查询目标')[0]!)
  expect(screen.queryByRole('heading', { name: /^(输入|输出)$/ })).toBeNull()
  expect(container.querySelector('.tool-details-footer')).toHaveTextContent('退出码 0')
  expect(container.querySelector('.tool-details-exit')).toHaveStyle({ textAlign: 'right' })
})
it.each([
  [0, '1ms'],
  [0.4, '1ms'],
  [0.6, '1ms'],
  [40.5, '41ms'],
  [999, '999ms'],
  [999.6, '1s'],
  [1000, '1s'],
  [1234, '1.2s'],
  [1250, '1.3s'],
  [1999, '2s']
] as const)(
  'shows exact ms or s with an ellipsized collapsed command and a clean expanded title (%i ms)',
  (durationMs, duration) => {
    const { container } = render(
      <ToolRow
        tool={tool({
          toolId: 'tools/local/command/shell/run',
          durationMs,
          details: {
            layout: 'terminal',
            input: [
              { label: '脚本', kind: 'code', language: 'shell', value: 'echo very-long-command' }
            ],
            output: [
              { label: '标准输出', kind: 'text', value: 'ok' },
              { label: '退出码', kind: 'text', value: '0', placement: 'footer' }
            ]
          }
        })}
      />
    )
    const row = container.querySelector('details')!
    expect(row.querySelector('summary')).toHaveTextContent(
      `已在 ${duration} 内运行 echo very-long-command`
    )
    expect(row.querySelector('.command-preview')).not.toBeNull()
    row.open = true
    fireEvent(row, new Event('toggle'))
    expect(row.querySelector('summary')).toHaveTextContent(`命令已在 ${duration} 内运行完成`)
    expect(row.querySelector('summary')).not.toHaveTextContent('echo')
    expect(row.querySelector('.activity-tool-io pre')).toHaveTextContent('$ echo very-long-command')
    expect(row.querySelector('.activity-tool-io pre')).toHaveTextContent('ok')
  }
)

it('keeps error at the bottom left and exit code at the bottom right', () => {
  const { container } = render(
    <ToolRow
      tool={tool({
        errorSummary: 'command failed',
        details: {
          input: [],
          output: [{ label: '退出码', kind: 'text', value: '1', placement: 'footer' }]
        }
      })}
    />
  )
  expect(container.querySelector('.tool-details-error')).toHaveTextContent('command failed')
  expect(container.querySelector('.tool-details-exit')).toHaveTextContent('退出码 1')
})

it('uses the same scroll height for a task group', () => {
  const { container } = render(
    <ActivityItems>
      <span>many tools</span>
    </ActivityItems>
  )
  expect(container.querySelector('.activity-items')).toHaveStyle({
    maxHeight: '640px',
    overflow: 'auto'
  })
})
it.each([
  ['tools/local/cua/js', '已操作桌面应用：获取系统状态', 'Computer Use', 'await cua.getState()', 'Notes is open'],
  ['tools/local/cua/js', '已操作浏览器：打开测试页面', 'Browser Use', 'await cua.createBrowserTab("iab", "https://example.org")', 'Fixture is open'],
  ['tools/local/cua/js', '已操作浏览器：查看标签页', 'Browser Use', 'await agent.browsers.get("iab")', 'Fixture is open']
] as const)('shows %s summary in the title and script input/output in the details',
  (toolId, title, panelTitle, source, output) => {
    const { container } = render(<ToolRow tool={tool({
      toolId, title, summary: title, durationMs: 1200,
      details: { layout: 'terminal', input: [{ label: '代码', kind: 'code', value: source }],
        output: [{ label: '输出', kind: 'text', value: output }] }
    })} />)
    const row = container.querySelector('.activity-tool-line')!
    expect(row).toHaveTextContent(title)
    fireEvent.click(row)
    expect(container.querySelector('.activity-tool-io-title')).toHaveTextContent(panelTitle)
    expect(container.querySelector('.activity-tool-io pre')).toHaveTextContent(source)
    expect(container.querySelector('.activity-tool-io pre')).toHaveTextContent(output)
    expect(container.querySelector('.activity-tool-io')).not.toHaveTextContent('结果摘要')
  })
it('keeps images and links in a third-party terminal layout', () => {
  const asset = {
    assetId: 'a',
    sessionId: 's',
    mimeType: 'image/png',
    width: 1,
    height: 1,
    byteLength: 1,
    source: 'generated'
  }
  render(
    <ToolRow
      tool={tool({
        details: {
          layout: 'terminal',
          input: [{ label: '代码', kind: 'code', value: 'capture()' }],
          output: [
            { label: '截图', kind: 'image', value: 'a', asset },
            { label: '来源', kind: 'link', value: 'https://example.com' }
          ]
        }
      })}
    />
  )
  expect(screen.getByText('图片无法读取')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'https://example.com' })).toBeInTheDocument()
})
