import { memo, useMemo, useRef } from 'react'
import { useScrollFade } from './scroll-fade'
import { markdownBlocks } from './markdown-blocks'

/** Renders only when its text changes, so a streaming message never re-parses the history. */
export const MarkdownContent = memo(function MarkdownContent({
  content,
  className
}: {
  content: string
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Blocks keep their identity while the message streams: only the open tail
  // is parsed, and React skips the untouched blocks because their HTML is equal.
  const blocks = useMemo(() => markdownBlocks(content), [content])
  // Code blocks and wide tables scroll horizontally inside a message.
  useScrollFade(rootRef, { selector: 'pre, table', deps: [blocks.length] })
  return (
    <div ref={rootRef} className={className} data-testid="e2e/tasks/detail/markdown#section">
      {blocks.map((block) => (
        <div
          key={block.key}
          className="markdown-block"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      ))}
    </div>
  )
})
