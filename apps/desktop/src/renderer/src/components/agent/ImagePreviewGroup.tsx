import type { ReactNode } from 'react'
import { Image } from 'antd'
import { Download, X } from 'lucide-react'

export type PreviewImage = {
  key: string
  /** Null while the image is still loading. */
  url: string | null
  alt: string
  downloadName: string
}

/**
 * Full-screen preview for one group of images: zoom, drag, rotate, flip, switch with the arrow
 * keys, save and close. The caller renders its own thumbnails and decides which one is open.
 * `renderClose` lets a caller put its own e2e id on the close control, since an id has to be
 * written on the element that carries it.
 */
export function ImagePreviewGroup({
  items,
  openIndex,
  onOpenChange,
  renderClose = defaultClose
}: {
  items: readonly PreviewImage[]
  openIndex: number | null
  onOpenChange(index: number | null): void
  renderClose?: (image: PreviewImage) => ReactNode
}) {
  const current = openIndex === null ? 0 : Math.min(openIndex, items.length - 1)
  const active = items[current]
  if (!active) return null
  return (
    <Image.PreviewGroup
      items={items.map((image) => ({ src: image.url ?? '', alt: image.alt }))}
      preview={{
        open: openIndex !== null,
        current,
        rootClassName: 'image-preview',
        onOpenChange: (open) => onOpenChange(open ? current : null),
        onChange: (next) => onOpenChange(next),
        closeIcon: renderClose(active),
        imageRender: (original) =>
          active.url ? (
            original
          ) : (
            <span className="image-preview-loading" role="status">
              正在加载图片
            </span>
          ),
        actionsRender: (original) => (
          <div className="image-preview-actions">
            {original}
            {active.url ? (
              <a
                className="image-preview-save"
                href={active.url}
                download={active.downloadName}
                aria-label="保存图片"
                data-testid="e2e/shared/image-preview/save#link"
              >
                <Download size={18} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        )
      }}
    />
  )
}

function defaultClose(): ReactNode {
  return (
    <span aria-label="关闭图片预览">
      <X size={20} aria-hidden="true" />
    </span>
  )
}
