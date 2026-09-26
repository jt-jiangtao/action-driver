import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, FileSpreadsheet, FileText, Plus, Presentation, Square, X } from 'lucide-react'
import { createEditor, Node, type Descendant } from 'slate'
import { Editable, Slate, withReact } from 'slate-react'
import type { ModelSelectionProjection } from '../models/model-selection'
import { ModelSelector } from './model-selector/ModelSelector'
import type { ModelRef } from '@actiondriver/contracts'
import { e2eId } from '../testing/e2e-id'
import { useScrollFade } from './scroll-fade'
import { ImagePreviewGroup } from './agent/ImagePreviewGroup'

type Paragraph = { type: 'paragraph'; children: { text: string }[] }

const DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
const MAX_ATTACHMENTS = 4

export type ComposerAttachments = { images: File[]; documents: File[] }

export function AgentComposer({
  initialText = '',
  running = false,
  disabled = false,
  onSubmit,
  onInterrupt,
  onAdd,
  modelSelection,
  onSelectModel,
  onOpenModelSettings,
  menuCloseKey,
  width = 720
}: {
  initialText?: string
  running?: boolean
  disabled?: boolean
  onSubmit(text: string, attachments?: ComposerAttachments): Promise<unknown> | void
  onInterrupt?(): void
  onAdd?(): void
  modelSelection?: ModelSelectionProjection
  onSelectModel?(model: ModelRef): void
  onOpenModelSettings?: (() => void) | undefined
  menuCloseKey?: string
  width?: 480 | 720
}) {
  const editor = useMemo(() => withReact(createEditor()), [])
  const editorRootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [documentFiles, setDocumentFiles] = useState<File[]>([])
  const [zoomedPreviewIndex, setZoomedPreviewIndex] = useState<number | null>(null)
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
  useScrollFade(editorRootRef, { deps: [draftText] })
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
    if (imageFiles.length + documentFiles.length + selected.length > MAX_ATTACHMENTS) {
      setSubmitError('每条消息最多添加 4 张图片')
      return
    }
    setImageFiles((current) => [...current, ...selected])
    setSubmitError(null)
  }
  const addDocuments = (files: FileList | File[]) => {
    const selected = Array.from(files)
    if (
      selected.some(
        (file) => !DOCUMENT_TYPES.includes(file.type) || file.size > MAX_DOCUMENT_BYTES
      )
    ) {
      setSubmitError('仅支持不超过 50 MiB 的 PDF、DOCX、PPTX 或 XLSX 文件')
      return
    }
    if (imageFiles.length + documentFiles.length + selected.length > MAX_ATTACHMENTS) {
      setSubmitError('每条消息最多添加 4 个附件')
      return
    }
    setDocumentFiles((current) => [...current, ...selected])
    setSubmitError(null)
  }
  const attachmentCount = imageFiles.length + documentFiles.length
  const attachments: ComposerAttachments = { images: imageFiles, documents: documentFiles }
  const submit = () => {
    const text = readText()
    if (running || disabled || submitting || (!text && attachmentCount === 0)) return
    setSubmitError(null)
    setSubmitting(true)
    void Promise.resolve()
      .then(() => (attachmentCount > 0 ? onSubmit(text, attachments) : onSubmit(text)))
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
      {previews.length ? (
        <div className="composer-image-previews">
          {previews.map((preview, index) => (
            <div className="composer-image-preview" key={`${preview.file.name}:${index}`}>
              <div className="composer-image-preview-frame">
                {preview.url ? (
                  <button
                    type="button"
                    className="composer-image-preview-open"
                    aria-label={`放大 ${preview.file.name}`}
                    data-testid={e2eId('e2e/shared/composer/images/:image-index/open#button', {
                      'image-index': String(index)
                    })}
                    onClick={() => setZoomedPreviewIndex(index)}
                  >
                    <img src={preview.url} alt={preview.file.name} />
                  </button>
                ) : null}
              </div>
              <div className="composer-image-preview-meta">
                <span title={preview.file.name}>{preview.file.name}</span>
                <button
                  type="button"
                  aria-label={`移除 ${preview.file.name}`}
                  data-testid={e2eId('e2e/shared/composer/images/:image-index/remove#button', {
                    'image-index': String(index)
                  })}
                  onClick={() => {
                    setZoomedPreviewIndex(null)
                    setImageFiles((files) => files.filter((_, at) => at !== index))
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {documentFiles.length ? (
        <ul className="composer-document-previews" aria-label="待发送文件">
          {documentFiles.map((file, index) => (
            <li className="composer-document-preview" key={`${file.name}:${index}`}>
              <span className="composer-document-icon" aria-hidden="true">
                {documentIcon(file.type)}
              </span>
              <span className="composer-document-name" title={file.name}>
                {file.name}
              </span>
              <span className="composer-document-size">{formatFileSize(file.size)}</span>
              <button
                type="button"
                aria-label={`移除 ${file.name}`}
                data-testid={e2eId('e2e/shared/composer/documents/:document-index/remove#button', {
                  'document-index': String(index)
                })}
                onClick={() => setDocumentFiles((files) => files.filter((_, at) => at !== index))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
              (currentText || attachmentCount > 0)
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
      {/* All images waiting to be sent form one preview group. */}
      <ImagePreviewGroup
        items={previews.map((preview, index) => ({
          key: `${preview.file.name}:${index}`,
          url: preview.url,
          alt: preview.file.name,
          downloadName: preview.file.name
        }))}
        openIndex={zoomedPreviewIndex}
        onOpenChange={setZoomedPreviewIndex}
        renderClose={() => (
          <span
            aria-label="关闭图片预览"
            data-testid="e2e/shared/composer/images/preview-close#button"
          >
            <X size={20} aria-hidden="true" />
          </span>
        )}
      />
      {submitError ? (
        <div className="composer-submit-error" role="alert">
          {submitError}
          {onOpenModelSettings && submitError.includes('视觉测试') ? (
            <button type="button" data-testid="e2e/shared/composer/open-model-settings#button" onClick={onOpenModelSettings}>打开模型设置</button>
          ) : null}
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
          <input
            ref={documentInputRef}
            className="composer-document-input"
            type="file"
            aria-label="选择文档"
            data-testid="e2e/shared/composer/documents/select#input"
            accept="application/pdf,.docx,.pptx,.xlsx"
            multiple
            onChange={(event) => {
              if (event.target.files) addDocuments(event.target.files)
              event.target.value = ''
            }}
          />
          <button
            className="composer-attach-document icon-button"
            type="button"
            aria-label="添加文档"
            data-testid="e2e/shared/composer/documents/attach#button"
            onClick={() => documentInputRef.current?.click()}
          >
            <FileText size={18} />
          </button>
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
            disabled={disabled || submitting || (!hasText && attachmentCount === 0)}
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

function documentIcon(mimeType: string) {
  if (mimeType.includes('spreadsheet')) return <FileSpreadsheet size={16} />
  if (mimeType.includes('presentation')) return <Presentation size={16} />
  return <FileText size={16} />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
