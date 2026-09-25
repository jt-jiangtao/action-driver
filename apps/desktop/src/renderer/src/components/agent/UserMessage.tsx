import type { AgentMessageProjection } from '@actiondriver/contracts'
import { ConversationImage, type ImageReader } from './ConversationImage'
import documentIconUrl from '../../assets/file-document.png'
import pdfIconUrl from '../../assets/file-pdf.png'
import presentationIconUrl from '../../assets/file-presentation.png'
import spreadsheetIconUrl from '../../assets/file-spreadsheet.png'

const FORMAT_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX'
}

function documentIcon(mimeType: string): string {
  if (mimeType.includes('spreadsheet')) return spreadsheetIconUrl
  if (mimeType.includes('presentation')) return presentationIconUrl
  if (mimeType === 'application/pdf') return pdfIconUrl
  return documentIconUrl
}

export function UserMessage({
  message,
  readImage
}: {
  message: AgentMessageProjection
  readImage?: ImageReader | undefined
}) {
  if (!message.parts?.some((part) => part.kind === 'image' || part.kind === 'document'))
    return <div className="user-message">{message.content}</div>
  return (
    <div className="user-message user-message-with-images">
      {[...message.parts]
        .sort((a, b) => Number(b.kind === 'image') - Number(a.kind === 'image'))
        .map((part, index) =>
          part.kind === 'image' ? (
            <ConversationImage
              key={`${part.asset.assetId}:${index}`}
              asset={part.asset}
              readImage={readImage}
            />
          ) : part.kind === 'document' ? (
            <article
              className="user-message-file"
              key={`file:${part.file.fileId}`}
              data-testid={`e2e/tasks/detail/user-message/file#section`}
              title={part.file.name}
            >
              <img
                className="user-message-file-icon"
                src={documentIcon(part.file.mimeType)}
                alt={FORMAT_LABELS[part.file.mimeType] ?? 'FILE'}
              />
              <span className="user-message-file-body">
                <span className="user-message-file-name">{part.file.name}</span>
                <span className="user-message-file-meta">
                  {formatFileSize(part.file.byteLength)}
                </span>
              </span>
            </article>
          ) : part.kind === 'text' && part.text.trim() ? (
            <span key={`text:${index}`}>{part.text}</span>
          ) : null
        )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
