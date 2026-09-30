import type { ToolPresentation } from '@action-driver/plugin-sdk'

/** Pure semantic metadata; importing it never activates the plugin. */
export const presentations: Record<string, ToolPresentation> = {
  'tools/local/web/search': {
    input: [
      { label: '搜索词', path: 'query', kind: 'text' },
      { label: '分类', path: 'categories', kind: 'text' },
      { label: '语言', path: 'language', kind: 'text' },
      { label: '安全搜索', path: 'safesearch', kind: 'text' },
      { label: '页码', path: 'pageno', kind: 'text' },
      { label: '最多结果', path: 'maxResults', kind: 'text' }
    ],
    output: [
      { label: '标题', path: 'result.results.*.title', kind: 'text' },
      { label: '链接', path: 'result.results.*.url', kind: 'link' },
      { label: '摘要', path: 'result.results.*.snippet', kind: 'text' },
      { label: '结果数量', path: 'result.totalResults', kind: 'text' },
      { label: '内容已截断', path: 'result.truncated', kind: 'text', hideFalse: true }
    ]
  },
  'tools/local/web/open': {
    input: [
      { label: '网页地址', path: 'url', kind: 'link' }
    ],
    output: [
      { label: '标题', path: 'result.title', kind: 'text' },
      { label: '网页地址', path: 'result.url', kind: 'link' },
      { label: '网页正文', path: 'result.text', kind: 'text' },
      { label: '内容已截断', path: 'result.truncated', kind: 'text', hideFalse: true }
    ]
  }
}
