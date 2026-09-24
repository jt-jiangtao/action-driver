export const colorTokens = {
  bgCanvas: '#FFFFFF',
  bgSidebar: '#F7F7F8',
  bgSurface: '#FFFFFF',
  bgSubtle: '#F1F1F2',
  bgHover: '#F1F1F2',
  bgSelected: '#EEF2FF',
  actionPrimary: '#5267F7',
  textPrimary: '#1F2228',
  textSecondary: '#5C616B',
  textTertiary: '#757A84',
  borderDefault: '#E8E8EA',
  statusSuccess: '#2FB67C',
  statusWarning: '#D98B25',
  statusDanger: '#D85454'
} as const

export const layoutTokens = {
  window: { width: 1440, height: 900 },
  sidebarWidth: 248,
  agentPanelWidth: 536,
  browserPanelWidth: 656,
  navigationRowHeight: 36,
  headerHeight: 56,
  browserTabHeight: 44
} as const

export const typographyTokens = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: 600 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: 600 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: 600 },
  body: { fontSize: 14, lineHeight: 20, fontWeight: 400 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: 500 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: 400 }
} as const

export const motionTokens = {
  instant: '80ms',
  fast: '160ms',
  standard: '240ms',
  emphasis: '360ms',
  long: '600ms',
  easingStandard: 'cubic-bezier(0.2, 0, 0, 1)',
  easingEmphasis: 'cubic-bezier(0.16, 1, 0.3, 1)'
} as const

export const radiusTokens = { sm: 6, md: 10, lg: 14, xl: 18, composer: 22 } as const

export const shadowTokens = {
  subtle: '0 2px 3px rgba(0, 0, 0, 0.12)',
  floating: '0 8px 12px rgba(0, 0, 0, 0.12)'
} as const
