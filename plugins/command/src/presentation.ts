import type { ToolPresentation } from '@actiondriver/plugin-sdk'

const commandOutput: ToolPresentation['output'] = [
  { label: '标准输出', path: 'stdout', kind: 'text' },
  { label: '标准错误', path: 'stderr', kind: 'text' },
  { label: '输出内容', path: 'content', kind: 'text' },
  { label: '退出码', path: 'result.exitCode', kind: 'text', placement: 'footer' }
]

/** Pure semantic metadata; importing it never activates the plugin. */
export const presentations: Record<string, ToolPresentation> = {
  'tools.local.command.shell.run': {
    layout: 'terminal',
    input: [
      { label: '脚本', path: 'script', kind: 'code', language: 'shell' },
      { label: '代码', path: 'code', kind: 'code', language: 'shell' },
      { label: '命令', path: 'command', kind: 'code', language: 'shell' },
      { label: '脚本文件', path: 'file', kind: 'text' },
      { label: '参数', path: 'args.*', kind: 'text' }
    ],
    output: commandOutput
  },
  'tools.local.command.python.run': {
    layout: 'terminal',
    input: [
      { label: '脚本', path: 'script', kind: 'code', language: 'python' },
      { label: '代码', path: 'code', kind: 'code', language: 'python' },
      { label: '命令', path: 'command', kind: 'code', language: 'shell' },
      { label: '脚本文件', path: 'file', kind: 'text' },
      { label: '参数', path: 'args.*', kind: 'text' }
    ],
    output: commandOutput
  },
  'tools.local.command.node.run': {
    layout: 'terminal',
    input: [
      { label: '脚本', path: 'script', kind: 'code', language: 'javascript' },
      { label: '代码', path: 'code', kind: 'code', language: 'javascript' },
      { label: '命令', path: 'command', kind: 'code', language: 'shell' },
      { label: '脚本文件', path: 'file', kind: 'text' },
      { label: '参数', path: 'args.*', kind: 'text' }
    ],
    output: commandOutput
  },
  'tools.local.command.typescript.run': {
    layout: 'terminal',
    input: [
      { label: '脚本', path: 'script', kind: 'code', language: 'typescript' },
      { label: '代码', path: 'code', kind: 'code', language: 'typescript' },
      { label: '命令', path: 'command', kind: 'code', language: 'shell' },
      { label: '脚本文件', path: 'file', kind: 'text' },
      { label: '参数', path: 'args.*', kind: 'text' }
    ],
    output: commandOutput
  },
  'tools.local.command.dependencies.load': {
    input: [],
    output: [
      { label: 'Node.js 路径', path: 'result.RUNTIME_NODE', kind: 'text' },
      { label: 'Node.js 库路径', path: 'result.RUNTIME_NODE_MODULES', kind: 'text' },
      { label: '工具目录', path: 'result.RUNTIME_BIN_DIR', kind: 'text' },
      { label: 'Python 路径', path: 'result.RUNTIME_PYTHON', kind: 'text' }
    ]
  }
}
