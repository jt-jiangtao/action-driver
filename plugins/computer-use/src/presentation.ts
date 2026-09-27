import type { ToolPresentation } from '@actiondriver/plugin-sdk'

/** Pure semantic metadata; importing it never activates the plugin. */
export const presentations: Record<string, ToolPresentation> = {
  'tools.local.computer-use.js': {
    input: [
      { label: '操作说明', path: 'title', kind: 'text' },
      { label: '执行代码', path: 'code', kind: 'code', language: 'javascript' },
      { label: '执行代码长度', path: 'codeLength', kind: 'text' },
      { label: '超时时间（毫秒）', path: 'timeout_ms', kind: 'text' }
    ],
    output: [
      { label: '执行输出', path: 'result.output', kind: 'text' },
      { label: '输出内容', path: 'content', kind: 'text' },
      { label: '文本', path: 'result.text', kind: 'text' },
      { label: '执行结果', path: 'result.result', kind: 'text' },
      { label: '执行状态', path: 'result.status', kind: 'text' },
      { label: '截图', path: 'assets.*', kind: 'image' }
    ]
  },
  'tools.local.computer-use.reset': {
    input: [],
    output: [
      { label: '已重置', path: 'result.reset', kind: 'text' }
    ]
  }
}
