import { memo, useMemo, useRef } from 'react'
import MarkdownIt from 'markdown-it'
import { useScrollFade } from './scroll-fade'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

/** Renders only when its text changes, so a streaming message never re-parses the history. */
export const MarkdownContent = memo(function MarkdownContent({
  content,
  className
}: {
  content: string
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Code blocks and wide tables scroll horizontally inside a message.
  useScrollFade(rootRef, { selector: 'pre, table', deps: [content] })
  const html = useMemo(() => ({ __html: markdown.render(content) }), [content])
  return (
    <div
      ref={rootRef}
      className={className}
      data-testid="e2e/tasks/detail/markdown#section"
      dangerouslySetInnerHTML={html}
    />
  )
})
