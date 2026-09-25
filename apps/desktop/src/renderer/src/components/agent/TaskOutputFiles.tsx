import { useEffect, useState } from 'react'
import { Image as ImageIcon, SquareArrowOutUpRight } from 'lucide-react'
import type { TaskOutputFileProjection } from '@actiondriver/contracts'
import { openTaskOutput } from '../../services/task-output-open'
import documentIconUrl from '../../assets/file-document.png'
import pdfIconUrl from '../../assets/file-pdf.png'
import presentationIconUrl from '../../assets/file-presentation.png'
import spreadsheetIconUrl from '../../assets/file-spreadsheet.png'
import imageIconUrl from '../../assets/file-image.svg'

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
            <TaskOutputThumbnail file={file} readOutputFile={readOutputFile} />
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
    </section>
  )
}

function TaskOutputThumbnail({
  file,
  readOutputFile
}: {
  file: TaskOutputFileProjection
  readOutputFile: OutputFileReader
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    void readOutputFile(file.sessionId, file.fileId, file.taskId)
      .then((blob) => {
        if (cancelled) return
        const next = URL.createObjectURL(blob)
        revoked = next
        setUrl(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [file.fileId, file.sessionId, file.taskId, readOutputFile])
  return (
    <span className="task-output-file-thumb">
      {url ? <img src={url} alt={file.name} /> : <ImageIcon size={16} aria-hidden="true" />}
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
