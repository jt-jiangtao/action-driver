import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import type { ImageAssetRef } from '@actiondriver/contracts'
import { e2eId } from '../../testing/e2e-id'

export type ImageReader = (sessionId: string, assetId: string) => Promise<Blob>

export function ConversationImage({
  asset,
  readImage
}: {
  asset: ImageAssetRef
  readImage?: ImageReader | undefined
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    if (!readImage) {
      setError(true)
      return
    }
    setError(false)
    setUrl(null)
    void readImage(asset.sessionId, asset.assetId)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [asset.assetId, asset.sessionId, readImage])
  useEffect(() => {
    if (!zoomed) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomed(false)
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [zoomed])
  if (error)
    return (
      <span className="conversation-image-missing" role="status">
        图片无法读取
      </span>
    )
  if (!url)
    return (
      <span className="conversation-image-loading" role="status">
        正在加载图片
      </span>
    )
  return (
    <span className="conversation-image-item">
      <button
        type="button"
        className="conversation-image-open"
        aria-label="放大图片"
        data-testid={e2eId('e2e/tasks/detail/images/:asset-id/open#button', {
          'asset-id': asset.assetId
        })}
        onClick={() => setZoomed(true)}
      >
        <img src={url} alt={asset.source === 'generated' ? '生成的图片' : '上传的图片'} />
      </button>
      <a
        href={url}
        download={`${asset.assetId}.${asset.mimeType.split('/')[1] === 'jpeg' ? 'jpg' : asset.mimeType.split('/')[1]}`}
        aria-label="保存图片"
        data-testid={e2eId('e2e/tasks/detail/images/:asset-id/save#link', {
          'asset-id': asset.assetId
        })}
        className="conversation-image-download"
      >
        <Download size={15} />
      </a>
      {zoomed ? (
        <div
          className="conversation-image-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <button
            type="button"
            aria-label="关闭图片预览"
            data-testid={e2eId('e2e/tasks/detail/images/:asset-id/close#button', {
              'asset-id': asset.assetId
            })}
            onClick={() => setZoomed(false)}
          >
            <X size={20} />
          </button>
          <img src={url} alt="图片预览" />
        </div>
      ) : null}
    </span>
  )
}
