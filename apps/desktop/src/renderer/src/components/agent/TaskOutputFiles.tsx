import { useCallback, useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, SquareArrowOutUpRight } from 'lucide-react'
import type { TaskOutputFileProjection } from '@action-driver/contracts'
import { openTaskOutput } from '../../services/task-output-open'
import documentIconUrl from '../../assets/file-document.png'
import pdfIconUrl from '../../assets/file-pdf.png'
import presentationIconUrl from '../../assets/file-presentation.png'
import spreadsheetIconUrl from '../../assets/file-spreadsheet.png'
import imageIconUrl from '../../assets/file-image.svg'
import { useObjectUrl } from '../../hooks/use-object-url'
import { ImagePreviewGroup } from './ImagePreviewGroup'

const FORMAT_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP'
}

export type OutputFileReader = (sessionId: string, fileId: string, taskId: string) => Promise<Blob>

export function TaskOutputFiles({
  files,
  readOutputFile
}: {
  files: readonly TaskOutputFileProjection[]
  readOutputFile?: OutputFileReader | undefined
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  // The task's image deliverables form one preview group; documents stay out of it.
  const images = useMemo(() => files.filter((file) => file.kind === 'image'), [files])
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const reportUrl = useCallback((fileId: string, url: string | null) => {
    setUrls((current) => (current[fileId] === url ? current : { ...current, [fileId]: url }))
  }, [])
  const openImage = useCallback(
    (fileId: string) => setOpenIndex(images.findIndex((file) => file.fileId === fileId)),
    [images]
  )
  if (files.length === 0) return null
  return (
    <section className="task-output-files" aria-label="任务成品">
      <span className="task-output-files-title">交付文件</span>
      {files.map((file) => (
        <article
          className="task-output-file"
          key={file.fileId}
          data-testid="e2e/tasks/detail/output-file#section"
        >
          {file.kind === 'image' && readOutputFile ? (
            <TaskOutputThumbnail
              file={file}
              readOutputFile={readOutputFile}
              onOpen={openImage}
              onUrlChange={reportUrl}
            />
          ) : (
            <img
              className="task-output-file-icon"
              src={skillIcon(file.mimeType)}
              alt={FORMAT_LABELS[file.mimeType] ?? 'FILE'}
            />
          )}
          <span className="task-output-file-body">
            <span className="task-output-file-name" title={file.name}>
              {file.name}
            </span>
            <span className="task-output-file-meta">{formatFileSize(file.byteLength)}</span>
          </span>
          <button
            type="button"
            className="task-output-file-open"
            data-testid="e2e/tasks/detail/output-file/open#button"
            onClick={() => {
              void openTaskOutput(file)
                .then(() => setErrors((current) => ({ ...current, [file.fileId]: '' })))
                .catch((error: unknown) =>
                  setErrors((current) => ({
                    ...current,
                    [file.fileId]: error instanceof Error ? error.message : '打开文件失败'
                  }))
                )
            }}
          >
            <SquareArrowOutUpRight size={14} aria-hidden="true" />
            <span>打开文件</span>
          </button>
          {errors[file.fileId] ? (
            <span className="task-output-file-error" role="alert">
              {errors[file.fileId]}
            </span>
          ) : null}
        </article>
      ))}
      <ImagePreviewGroup
        items={images.map((file) => ({
          key: file.fileId,
          url: urls[file.fileId] ?? null,
          alt: file.name,
          downloadName: file.name
        }))}
        openIndex={openIndex}
        onOpenChange={setOpenIndex}
      />
    </section>
  )
}

function TaskOutputThumbnail({
  file,
  readOutputFile,
  onOpen,
  onUrlChange
}: {
  file: TaskOutputFileProjection
  readOutputFile: OutputFileReader
  onOpen(fileId: string): void
  onUrlChange(fileId: string, url: string | null): void
}) {
  const load = useCallback(
    () => readOutputFile(file.sessionId, file.fileId, file.taskId),
    [file.fileId, file.sessionId, file.taskId, readOutputFile]
  )
  const { url } = useObjectUrl(load)
  useEffect(() => {
    onUrlChange(file.fileId, url)
  }, [file.fileId, onUrlChange, url])
  return url ? (
    <button
      type="button"
      className="task-output-file-thumb"
      aria-label={`预览 ${file.name}`}
      data-testid="e2e/tasks/detail/output-file/preview#button"
      onClick={() => onOpen(file.fileId)}
    >
      <img src={url} alt={file.name} />
    </button>
  ) : (
    <span className="task-output-file-thumb">
      <ImageIcon size={16} aria-hidden="true" />
    </span>
  )
}

/** Reuses the icon each bundled Skill declares for its own file type. */
function skillIcon(mimeType: string): string {
  if (mimeType.includes('spreadsheet')) return spreadsheetIconUrl
  if (mimeType.includes('presentation')) return presentationIconUrl
  if (mimeType === 'application/pdf') return pdfIconUrl
  if (mimeType.startsWith('image/')) return imageIconUrl
  return documentIconUrl
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
