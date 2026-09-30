import type { ToolPresentation } from '@action-driver/plugin-sdk'

/** Pure semantic metadata; importing it never activates the plugin. */
export const presentations: Record<string, ToolPresentation> = {
  'tools/local/skills/read': {
    input: [
      { label: 'Skill 名称', path: 'skillId', kind: 'text' },
      { label: '文件路径', path: 'path', kind: 'text' }
    ],
    output: [
      { label: 'Skill 名称', path: 'result.skillId', kind: 'text' },
      { label: '文件路径', path: 'result.path', kind: 'text' },
      { label: '文件内容', path: 'result.content', kind: 'text' }
    ]
  },
  'tools/local/skills/install': {
    input: [
      { label: '安装来源', path: 'source', kind: 'text' },
      { label: '来源地址', path: 'url', kind: 'link' },
      { label: '来源目录', path: 'path', kind: 'text' }
    ],
    output: [
      { label: 'Skill 名称', path: 'result.name', kind: 'text' },
      { label: 'Skill 标识', path: 'result.id', kind: 'text' },
      { label: '安装来源', path: 'result.source', kind: 'text' },
      { label: '已启用', path: 'result.enabled', kind: 'text' },
      { label: '说明', path: 'result.description', kind: 'text' },
      { label: '可用', path: 'result.available', kind: 'text' }
    ]
  }
}
