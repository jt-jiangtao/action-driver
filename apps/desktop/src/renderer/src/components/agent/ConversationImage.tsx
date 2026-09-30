import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Download, X } from 'lucide-react'
import type { ImageAssetRef } from '@action-driver/contracts'
import { e2eId } from '../../testing/e2e-id'
import { useObjectUrl } from '../../hooks/use-object-url'
import { ImagePreviewGroup } from './ImagePreviewGroup'

export type ImageReader = (sessionId: string, assetId: string) => Promise<Blob>

/** One thumbnail. Opening it is the group's decision; the thumbnail only reports its URL. */
export function ConversationImage({
  asset,
  readImage,
  onOpen,
  onUrlChange
}: {
  asset: ImageAssetRef
  readImage?: ImageReader | undefined
  onOpen?: ((assetId: string) => void) | undefined
  onUrlChange?: ((assetId: string, url: string | null) => void) | undefined
}) {
  const load = useCallback(
    () => readImage!(asset.sessionId, asset.assetId),
    [asset.assetId, asset.sessionId, readImage]
  )
  const loaded = useObjectUrl(readImage ? load : null)
  const [failed, setFailed] = useState(false)
  const url = failed ? null : loaded.url
  useEffect(() => {
    onUrlChange?.(asset.assetId, url)
  }, [asset.assetId, onUrlChange, url])
  if (loaded.error || failed)
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
        onClick={() => onOpen?.(asset.assetId)}
      >
        <img src={url} alt={imageAlt(asset)} onError={() => setFailed(true)} />
      </button>
      <a
        href={url}
        download={downloadName(asset)}
        aria-label="保存图片"
        data-testid={e2eId('e2e/tasks/detail/images/:asset-id/save#link', {
          'asset-id': asset.assetId
        })}
        className="conversation-image-download"
      >
        <Download size={15} />
      </a>
    </span>
  )
}

/**
 * Preview state for one group of conversation images (one generation call or one message). The
 * thumbnails report their URLs; the preview switches only within this group.
 */
export function useImagePreview(assets: readonly ImageAssetRef[]): {
  open(assetId: string): void
  reportUrl(assetId: string, url: string | null): void
  preview: ReactNode
} {
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const reportUrl = useCallback((assetId: string, url: string | null) => {
    setUrls((current) => (current[assetId] === url ? current : { ...current, [assetId]: url }))
  }, [])
  const open = useCallback(
    (assetId: string) => {
      const index = assets.findIndex((asset) => asset.assetId === assetId)
      if (index >= 0) setOpenIndex(index)
    },
    [assets]
  )
  const preview = assets.length ? (
    <ImagePreviewGroup
      items={assets.map((asset) => ({
        key: asset.assetId,
        url: urls[asset.assetId] ?? null,
        alt: imageAlt(asset),
        downloadName: downloadName(asset)
      }))}
      openIndex={openIndex}
      onOpenChange={setOpenIndex}
      renderClose={(image) => (
        <span
          aria-label="关闭图片预览"
          data-testid={e2eId('e2e/tasks/detail/images/:asset-id/close#button', {
            'asset-id': image.key
          })}
        >
          <X size={20} aria-hidden="true" />
        </span>
      )}
    />
  ) : null
  return { open, reportUrl, preview }
}

function imageAlt(asset: ImageAssetRef): string {
  return asset.source === 'generated' ? '生成的图片' : '上传的图片'
}

function downloadName(asset: ImageAssetRef): string {
  const subtype = asset.mimeType.split('/')[1]
  return `${asset.assetId}.${subtype === 'jpeg' ? 'jpg' : subtype}`
}
