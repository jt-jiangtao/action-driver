import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Plus, Square, X } from 'lucide-react'
import { createEditor, Node, type Descendant } from 'slate'
import { Editable, Slate, withReact } from 'slate-react'
import type { ModelSelectionProjection } from '../models/model-selection'
import { ModelSelector } from './model-selector/ModelSelector'
import type { ModelRef } from '@actiondriver/contracts'
import { e2eId } from '../testing/e2e-id'

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
  onSubmit(text: string, imageFiles?: File[]): Promise<unknown> | void
  onInterrupt?(): void
  onAdd?(): void
  modelSelection?: ModelSelectionProjection
  onSelectModel?(model: ModelRef): void
  menuCloseKey?: string
  width?: 480 | 720
}) {
  const editor = useMemo(() => withReact(createEditor()), [])
  const editorRootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const previews = useMemo(
    () =>
      imageFiles.map((file) => ({
        file,
        url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
      })),
    [imageFiles]
  )
  useEffect(
    () => () => {
      for (const preview of previews) if (preview.url) URL.revokeObjectURL(preview.url)
    },
    [previews]
  )
  const initialValue = useMemo<Descendant[]>(
    () => [{ type: 'paragraph', children: [{ text: initialText }] } as Paragraph],
    [initialText]
  )
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
  const addImages = (files: FileList | File[]) => {
    const selected = Array.from(files)
    if (
      selected.some(
        (file) =>
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
          file.size > 20 * 1024 * 1024
      )
    ) {
      setSubmitError('仅支持不超过 20 MiB 的 PNG、JPEG 或 WebP 图片')
      return
    }
    if (imageFiles.length + selected.length > 4) {
      setSubmitError('每条消息最多添加 4 张图片')
      return
    }
    setImageFiles((current) => [...current, ...selected])
    setSubmitError(null)
  }
  const submit = () => {
    const text = readText()
    if (running || disabled || submitting || (!text && imageFiles.length === 0)) return
    setSubmitError(null)
    setSubmitting(true)
    void Promise.resolve()
      .then(() => (imageFiles.length ? onSubmit(text, imageFiles) : onSubmit(text)))
      .catch((error: unknown) =>
        setSubmitError(error instanceof Error ? error.message : '发送失败')
      )
      .finally(() => setSubmitting(false))
  }

  return (
    <div
      className="agent-composer"
      data-testid="e2e/shared/composer/root#section"
      data-state={running ? 'running' : disabled ? 'disabled' : 'idle'}
      data-width={width}
    >
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
          readOnly={running || disabled}
          onInput={(event) => {
            const nextText = readEditableText(event.currentTarget)
            setDraftText(nextText)
            setHasText(Boolean(nextText.trim()))
          }}
          onKeyDown={(event) => {
            const currentText = readText()
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !running &&
              !disabled &&
              (currentText || imageFiles.length)
            ) {
              event.preventDefault()
              submit()
            }
          }}
          onPaste={(event) => {
            if (event.clipboardData.files.length) {
              event.preventDefault()
              addImages(event.clipboardData.files)
            }
          }}
        />
      </Slate>
      {previews.length ? (
        <div className="composer-image-previews">
          {previews.map((preview, index) => (
            <div className="composer-image-preview" key={`${preview.file.name}:${index}`}>
              {preview.url ? <img src={preview.url} alt="待发送图片预览" /> : null}
              <span>{preview.file.name}</span>
              <button
                type="button"
                aria-label={`移除 ${preview.file.name}`}
                data-testid={e2eId('e2e/shared/composer/images/:image-index/remove#button', {
                  'image-index': String(index)
                })}
                onClick={() => setImageFiles((files) => files.filter((_, at) => at !== index))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {submitError ? (
        <div className="composer-submit-error" role="alert">
          {submitError}
        </div>
      ) : null}
      <div className="composer-actions">
        <div className="composer-leading-actions">
          <input
            ref={fileInputRef}
            className="composer-image-input"
            type="file"
            aria-label="添加图片"
            data-testid="e2e/shared/composer/images/select#input"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => {
              if (event.target.files) addImages(event.target.files)
              event.target.value = ''
            }}
          />
          <button
            className="composer-add icon-button"
            aria-label="添加"
            data-testid="e2e/shared/composer/add#button"
            type="button"
            onClick={() => {
              if (onAdd) onAdd()
              else fileInputRef.current?.click()
            }}
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
            disabled={disabled || submitting || (!hasText && imageFiles.length === 0)}
            onClick={submit}
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
