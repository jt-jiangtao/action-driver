import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

export function MarkdownContent({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={className}
      data-testid="markdown-content"
      dangerouslySetInnerHTML={{ __html: markdown.render(content) }}
    />
  )
}
