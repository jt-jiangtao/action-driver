import { describe, expect, it } from 'vitest'
import { scrollFadeEdges } from './scroll-fade'

const base = {
  scrollTop: 0,
  scrollLeft: 0,
  scrollHeight: 1000,
  scrollWidth: 400,
  clientHeight: 400,
  clientWidth: 400
}

describe('scroll fade edges', () => {
  it('fades only the edges that still hide content', () => {
    expect(scrollFadeEdges(base)).toEqual(['bottom'])
    expect(scrollFadeEdges({ ...base, scrollTop: 300 })).toEqual(['top', 'bottom'])
    expect(scrollFadeEdges({ ...base, scrollTop: 600 })).toEqual(['top'])
  })

  it('fades horizontal edges independently of vertical ones', () => {
    expect(scrollFadeEdges({ ...base, scrollTop: 600, scrollWidth: 900 })).toEqual([
      'top',
      'right'
    ])
    expect(
      scrollFadeEdges({ ...base, scrollTop: 600, scrollWidth: 900, scrollLeft: 500 })
    ).toEqual(['top', 'left'])
  })

  it('keeps content unfaded when nothing overflows', () => {
    expect(
      scrollFadeEdges({ ...base, scrollHeight: 400, scrollWidth: 400, scrollTop: 0 })
    ).toEqual([])
  })
})
