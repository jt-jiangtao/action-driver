import type { ToolPresentation } from '@actiondriver/plugin-sdk'

/** Pure semantic metadata; importing it never activates the plugin. */
export const presentations: Record<string, ToolPresentation> = {
  'tools.local.image-generation.generate': {
    input: [
      { label: '图片描述', path: 'images.*.prompt', kind: 'text' }
    ],
    output: [
      { label: '已生成图片', path: 'result.succeeded', kind: 'text' },
      { label: '生成失败数量', path: 'result.failed', kind: 'text' },
      { label: '图片', path: 'assets.*', kind: 'image' }
    ]
  }
}
