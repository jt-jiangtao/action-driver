import { useCallback, useEffect, useMemo } from 'react'
import { createEditor, Node, type Descendant } from 'slate'
import { Editable, Slate, withReact, type RenderElementProps } from 'slate-react'
import { e2eId } from '../../testing/e2e-id'

type MarkdownBlockType =
  | 'paragraph'
  | 'heading-one'
  | 'heading-two'
  | 'heading-three'
  | 'list-item'
  | 'blockquote'
  | 'code-fence'
  | 'code-line'

type MarkdownBlock = {
  type: MarkdownBlockType
  children: { text: string }[]
}

function parseMarkdown(markdown: string): Descendant[] {
  let inCodeBlock = false
  const blocks = markdown.split('\n').map((line): MarkdownBlock => {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      return { type: 'code-fence', children: [{ text: line.slice(3) }] }
    }
    if (inCodeBlock) return { type: 'code-line', children: [{ text: line }] }
    if (line.startsWith('### '))
      return { type: 'heading-three', children: [{ text: line.slice(4) }] }
    if (line.startsWith('## ')) return { type: 'heading-two', children: [{ text: line.slice(3) }] }
    if (line.startsWith('# ')) return { type: 'heading-one', children: [{ text: line.slice(2) }] }
    if (line.startsWith('- ')) return { type: 'list-item', children: [{ text: line.slice(2) }] }
    if (line.startsWith('> ')) return { type: 'blockquote', children: [{ text: line.slice(2) }] }
    return { type: 'paragraph', children: [{ text: line }] }
  })
  return blocks.length > 0
    ? (blocks as Descendant[])
    : ([{ type: 'paragraph', children: [{ text: '' }] }] as unknown as Descendant[])
}

function serializeMarkdown(blocks: Descendant[]): string {
  return blocks
    .map((block) => {
      const element = block as MarkdownBlock
      const text = Node.string(block)
      if (element.type === 'heading-one') return `# ${text}`
      if (element.type === 'heading-two') return `## ${text}`
      if (element.type === 'heading-three') return `### ${text}`
      if (element.type === 'list-item') return `- ${text}`
      if (element.type === 'blockquote') return `> ${text}`
      if (element.type === 'code-fence') return `\`\`\`${text}`
      return text
    })
    .join('\n')
}

function MarkdownElementView({ attributes, children, element }: RenderElementProps) {
  const block = element as MarkdownBlock
  if (block.type === 'heading-one') return <h1 {...attributes}>{children}</h1>
  if (block.type === 'heading-two') return <h2 {...attributes}>{children}</h2>
  if (block.type === 'heading-three') return <h3 {...attributes}>{children}</h3>
  if (block.type === 'list-item')
    return (
      <div {...attributes} className="markdown-list-item">
        {children}
      </div>
    )
  if (block.type === 'blockquote') return <blockquote {...attributes}>{children}</blockquote>
  if (block.type === 'code-fence')
    return (
      <div {...attributes} className="markdown-code-fence">
        {children}
      </div>
    )
  if (block.type === 'code-line') return <pre {...attributes}>{children}</pre>
  return <p {...attributes}>{children}</p>
}

export function MarkdownVisualEditor({
  value,
  ariaLabel,
  editorId,
  onChange
}: {
  value: string
  ariaLabel: string
  editorId: string
  onChange(value: string): void
}) {
  const editor = useMemo(() => withReact(createEditor()), [])
  const initialValue = useMemo(() => parseMarkdown(value), [])
  const renderElement = useCallback(
    (props: RenderElementProps) => <MarkdownElementView {...props} />,
    []
  )

  useEffect(() => {
    if (serializeMarkdown(editor.children) === value) return
    editor.children = parseMarkdown(value)
    editor.selection = null
    editor.onChange()
  }, [editor, value])

  return (
    <Slate
      editor={editor}
      initialValue={initialValue}
      onChange={(blocks) => onChange(serializeMarkdown(blocks))}
    >
      <Editable
        className="agent-markdown-editor is-edit"
        aria-label={ariaLabel}
        data-testid={e2eId('e2e/settings/agent-editors/:editor-id/content#input', {
          'editor-id': editorId
        })}
        renderElement={renderElement}
        spellCheck
      />
    </Slate>
  )
}
