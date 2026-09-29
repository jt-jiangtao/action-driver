import { describe, expect, it, vi } from 'vitest'
import {
  markdownBlockCacheSize,
  markdownBlocks,
  markdownIt
} from '../../../../../src/renderer/src/components/markdown-blocks'

const corpus = [
  '# 标题\n\n段落一\n继续一行\n\n> 引用\n\n| a | b |\n| - | - |\n| 1 | 2 |',
  '- a\n\n- b',
  '1. one\n\n2. two',
  '```js\nconst a = 1\n\nconsole.log(a)\n```\n\n尾注 **加粗** 与 [链接](https://example.com)',
  '文本\n\n    indented code\n\n结束',
  '- 顶层\n  - 嵌套\n\n- 第二项\n\n> 引用\n> 第二行\n\n```\nfence\n```',
  '单段流式中途 **未闭合的强调**'
]

describe('markdown blocks', () => {
  it.each(corpus)('renders %# exactly like one whole-document pass', (content) => {
    const joined = markdownBlocks(content)
      .map((block) => block.html)
      .join('')
    expect(joined).toBe(markdownIt.render(content))
  })

  it('keeps a loose list in one block instead of splitting it at the blank line', () => {
    const blocks = markdownBlocks('- a\n\n- b')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.html).toContain('</li>\n<li>')
  })

  it('caches closed blocks so a streaming tail reuses their html', () => {
    const head = '# 标题\n\n第一段'
    markdownBlocks(head)
    const before = markdownBlockCacheSize()
    const renderer = vi.spyOn(markdownIt.renderer, 'render')

    const blocks = markdownBlocks(`${head}\n\n第二段正在流式`)

    // Heading + first paragraph + the open streaming tail.
    expect(blocks).toHaveLength(3)
    // Only the open tail is rendered; the two closed blocks come from the cache.
    expect(renderer).toHaveBeenCalledTimes(1)
    expect(renderer.mock.calls[0]![0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'paragraph_open' })])
    )
    expect(markdownBlockCacheSize()).toBeGreaterThan(before)
    renderer.mockRestore()
  })

  it('keeps block keys stable while text is appended', () => {
    const first = markdownBlocks('# 标题\n\n第一段').map((block) => block.key)
    const second = markdownBlocks('# 标题\n\n第一段\n\n第二段').map((block) => block.key)
    expect(second.slice(0, first.length)).toEqual(first)
  })
})
