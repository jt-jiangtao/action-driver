import { useRef } from 'react'
import MarkdownIt from 'markdown-it'
import { useScrollFade } from './scroll-fade'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

export function MarkdownContent({ content, className }: { content: string; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Code blocks and wide tables scroll horizontally inside a message.
  useScrollFade(rootRef, { selector: 'pre, table', deps: [content] })
  return (
    <div
      ref={rootRef}
      className={className}
      data-testid="e2e/tasks/detail/markdown#section"
      dangerouslySetInnerHTML={{ __html: markdown.render(content) }}
    />
  )
}
