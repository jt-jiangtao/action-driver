import { useMemo, useRef, useState } from 'react'
import { ArrowUp, Plus, Square } from 'lucide-react'
import { createEditor, Node, type Descendant } from 'slate'
import { Editable, Slate, withReact } from 'slate-react'
import type { ModelSelectionProjection } from '../models/model-selection'
import { ModelSelector } from './model-selector/ModelSelector'
import type { ModelRef } from '@actiondriver/contracts'

type Paragraph = { type: 'paragraph'; children: { text: string }[] }

export function AgentComposer({
  initialText = '',
  running = false,
  disabled = false,
  onSubmit,
  onInterrupt,
  onAdd,
  modelSelection,
  onSelectModel,
  menuCloseKey,
  width = 720
}: {
  initialText?: string
  running?: boolean
  disabled?: boolean
  onSubmit(text: string): void
  onInterrupt?(): void
  onAdd?(): void
  modelSelection?: ModelSelectionProjection
  onSelectModel?(model: ModelRef): void
  menuCloseKey?: string
  width?: 480 | 720
}) {
  const editor = useMemo(() => withReact(createEditor()), [])
  const editorRootRef = useRef<HTMLDivElement>(null)
  const initialValue: Descendant[] = [
    { type: 'paragraph', children: [{ text: initialText }] } as Paragraph
  ]
  const [hasText, setHasText] = useState(Boolean(initialText.trim()))
  const [draftText, setDraftText] = useState(initialText)
  const readText = () => {
    const domText = readEditableText(editorRootRef.current)
    const slateText = editor.children
      .map((entry) => Node.string(entry))
      .join('\n')
      .trim()
    return domText || slateText || draftText.trim()
  }

  return (
    <div className="agent-composer" data-width={width}>
      <Slate
        editor={editor}
        initialValue={initialValue}
        onChange={(nextValue) => {
          const nextText = nextValue.map((entry) => Node.string(entry)).join('\n')
          setDraftText(nextText)
          setHasText(Boolean(nextText.trim()))
        }}
      >
        <Editable
          ref={editorRootRef}
          className="composer-editor"
          aria-label="任务描述"
          data-testid="e2e/shared/composer/editor#input"
          placeholder="随心输入"
          readOnly={disabled}
          onInput={(event) => {
            const nextText = readEditableText(event.currentTarget)
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
        <div className="composer-leading-actions">
          <button
            className="composer-add icon-button"
            aria-label="添加"
            data-testid="e2e/shared/composer/add#button"
            type="button"
            onClick={onAdd}
          >
            <Plus />
          </button>
          {modelSelection && onSelectModel ? (
            <ModelSelector
              projection={modelSelection}
              onSelect={onSelectModel}
              {...(menuCloseKey ? { closeKey: menuCloseKey } : {})}
            />
          ) : null}
        </div>
        {running ? (
          <button
            className="composer-submit composer-stop"
            aria-label="中断任务"
            data-testid="e2e/shared/composer/interrupt#button"
            onClick={onInterrupt}
          >
            <Square />
          </button>
        ) : (
          <button
            className="composer-submit"
            aria-label="发送"
            data-testid="e2e/shared/composer/send#button"
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

function readEditableText(element: HTMLElement | null): string {
  if (!element) return ''
  const editable = element.cloneNode(true) as HTMLElement
  editable.querySelectorAll('[data-slate-placeholder]').forEach((node) => node.remove())
  return (editable.textContent ?? '').replaceAll('\uFEFF', '').trim()
}
