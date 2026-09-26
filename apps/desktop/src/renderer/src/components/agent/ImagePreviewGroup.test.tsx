import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ImagePreviewGroup, type PreviewImage } from './ImagePreviewGroup'
import agentStyles from '../../styles/agent.css?raw'

const images: PreviewImage[] = [
  {
    key: 'a',
    url: 'blob:a',
    alt: '第一张',
    downloadName: 'a.png'
  },
  {
    key: 'b',
    url: 'blob:b',
    alt: '第二张',
    downloadName: 'b.png'
  }
]

function Harness({ items = images }: { items?: PreviewImage[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  return (
    <>
      {items.map((image, index) => (
        <button key={image.key} type="button" onClick={() => setOpenIndex(index)}>
          打开 {image.alt}
        </button>
      ))}
      <span data-testid="open-index">{String(openIndex)}</span>
      <ImagePreviewGroup
        items={items}
        openIndex={openIndex}
        onOpenChange={setOpenIndex}
        renderClose={(image) => <span data-testid={`close-${image.key}`}>关闭</span>}
      />
    </>
  )
}

function previewImage() {
  return document.querySelector<HTMLImageElement>('.image-preview img[src^="blob:"]')
}

function pressKey(key: string, keyCode: number) {
  act(() => {
    fireEvent.keyDown(window, { key, keyCode, which: keyCode })
  })
}

describe('ImagePreviewGroup', () => {
  it('stays closed until an image is opened', () => {
    render(<Harness />)
    expect(previewImage()).toBeNull()
  })

  it('opens the chosen image with zoom, rotate and flip controls', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '打开 第二张' }))

    expect(previewImage()).toHaveAttribute('src', 'blob:b')
    for (const action of ['zoomIn', 'zoomOut', 'rotateLeft', 'rotateRight', 'flipX', 'flipY'])
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
  })

  it('moves within the group with the arrow keys and never past its ends', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '打开 第一张' }))

    pressKey('ArrowRight', 39)
    expect(previewImage()).toHaveAttribute('src', 'blob:b')
    expect(screen.getByTestId('open-index')).toHaveTextContent('1')

    pressKey('ArrowRight', 39)
    expect(previewImage()).toHaveAttribute('src', 'blob:b')

    pressKey('ArrowLeft', 37)
    expect(previewImage()).toHaveAttribute('src', 'blob:a')
  })

  it('saves the image on screen', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '打开 第一张' }))
    pressKey('ArrowRight', 39)

    const save = screen.getByTestId('e2e/shared/image-preview/save#link')
    expect(save).toHaveAttribute('href', 'blob:b')
    expect(save).toHaveAttribute('download', 'b.png')
  })

  it('closes with the close button and with Escape', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '打开 第一张' }))
    fireEvent.click(screen.getByTestId('close-a'))
    expect(screen.getByTestId('open-index')).toHaveTextContent('null')

    fireEvent.click(screen.getByRole('button', { name: '打开 第二张' }))
    pressKey('Escape', 27)
    expect(screen.getByTestId('open-index')).toHaveTextContent('null')
  })

  it('shows a loading state for an image that is not loaded yet', () => {
    render(<Harness items={[{ ...images[0]!, url: null }]} />)
    fireEvent.click(screen.getByRole('button', { name: '打开 第一张' }))
    expect(screen.getByRole('status')).toHaveTextContent('正在加载图片')
  })

  // The task and home headers are window drag regions. The OS handles those before the page does,
  // whatever sits on top, so a real click on the close button would drag the window instead.
  it('keeps the preview out of the window drag regions so its controls take real clicks', () => {
    expect(agentStyles).toMatch(/\.image-preview\s*\{[^}]*-webkit-app-region:\s*no-drag/s)
  })
})
