import { describe, expect, it } from 'vitest'
import { colorTokens, layoutTokens, motionTokens, typographyTokens } from '../../../../../src/renderer/src/styles/tokens'

describe('Action-Driver design tokens', () => {
  it('matches the Figma foundations used by the desktop layouts', () => {
    expect(colorTokens.actionPrimary).toBe('#5267F7')
    expect(colorTokens.bgSidebar).toBe('#F7F7F8')
    expect(colorTokens.textPrimary).toBe('#1F2228')
    expect(layoutTokens.window).toEqual({ width: 1440, height: 900 })
    expect(layoutTokens.sidebarWidth).toBe(248)
    expect(layoutTokens.agentPanelWidth).toBe(536)
    expect(layoutTokens.browserPanelWidth).toBe(656)
    expect(typographyTokens.display).toEqual({ fontSize: 28, lineHeight: 34, fontWeight: 600 })
    expect(motionTokens).toEqual({
      instant: '80ms',
      fast: '160ms',
      standard: '240ms',
      emphasis: '360ms',
      long: '600ms',
      easingStandard: 'cubic-bezier(0.2, 0, 0, 1)',
      easingEmphasis: 'cubic-bezier(0.16, 1, 0.3, 1)'
    })
  })
})
