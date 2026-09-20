import { useMemo, useState } from 'react'
import { ArrowUp, Plus, Square } from 'lucide-react'
import { createEditor, Node, type Descendant } from 'slate'
import { Editable, Slate, withReact } from 'slate-react'

type Paragraph = { type: 'paragraph'; children: { text: string }[] }

export function AgentComposer({
  initialText = '',
  running = false,
  disabled = false,
  onSubmit,
  onInterrupt,
  onAdd,
  width = 720
}: {
  initialText?: string
  running?: boolean
  disabled?: boolean
  onSubmit(text: string): void
  onInterrupt?(): void
  onAdd?(): void
  width?: 480 | 720
}) {
  const editor = useMemo(() => withReact(createEditor()), [])
  const initialValue: Descendant[] = [
    { type: 'paragraph', children: [{ text: initialText }] } as Paragraph
  ]
  const [hasText, setHasText] = useState(Boolean(initialText.trim()))
  const [draftText, setDraftText] = useState(initialText)
  const readText = () => {
    const slateText = editor.children
      .map((entry) => Node.string(entry))
      .join('\n')
      .trim()
    return slateText || draftText.trim()
  }

  return (
    <div className="agent-composer" data-width={width} style={{ width }}>
      <Slate
        editor={editor}
        initialValue={initialValue}
        onChange={(nextValue) => {
          setHasText(nextValue.some((entry) => Node.string(entry).trim().length > 0))
        }}
      >
        <Editable
          className="composer-editor"
          aria-label="任务描述"
          placeholder="随心输入"
          readOnly={disabled}
          onInput={(event) => {
            const nextText = event.currentTarget.textContent ?? ''
            setDraftText(nextText)
            setHasText(Boolean(nextText.trim()))
          }}
          onKeyDown={(event) => {
            const currentText = readText()
            if (event.key === 'Enter' && !event.shiftKey && !running && !disabled && currentText) {
              event.preventDefault()
              onSubmit(currentText)
            }
          }}
        />
      </Slate>
      <div className="composer-actions">
        <button
          className="composer-add icon-button"
          aria-label="添加"
          type="button"
          onClick={onAdd}
        >
          <Plus />
        </button>
        {running ? (
          <button
            className="composer-submit composer-stop"
            aria-label="中断任务"
            onClick={onInterrupt}
          >
            <Square />
          </button>
        ) : (
          <button
            className="composer-submit"
            aria-label="发送"
            disabled={disabled || !hasText}
            onClick={() => {
              const currentText = readText()
              if (currentText) onSubmit(currentText)
            }}
          >
            <ArrowUp />
          </button>
        )}
      </div>
    </div>
  )
}
