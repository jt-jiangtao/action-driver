import { useCallback, useEffect, useState } from 'react'
import type {
  ComputerPermissionStatus
} from '../../../../shared/computer-use-contract'
import { AppIcon } from '../ui/AppIcon'
import { ActionDriverLogo } from '../ActionDriverLogo'

type GuidancePermissionKey = 'accessibility' | 'screenRecording'

/**
 * Mirrors the Codex Computer Use onboarding window one to one. Kept as a single constant so the
 * product name in the copy can be changed in one place.
 */
const PRODUCT_NAME = 'Codex'

const permissionRows: Array<{
  key: GuidancePermissionKey
  title: string
  description: string
}> = [
  {
    key: 'accessibility',
    title: '辅助功能',
    description: `允许 ${PRODUCT_NAME} 访问 App 界面`
  },
  {
    key: 'screenRecording',
    title: '屏幕录制',
    description: `${PRODUCT_NAME} 通过截图判断该点哪里`
  },
  // Posting input events is covered by the Accessibility grant; a separate row would imply a
  // permission the user cannot actually turn on by itself.
]

/** Blue ring with a blue standing figure, matching the reference window. */
function AccessibilityGlyph() {
  return <span className="computer-permission-glyph">
    <svg aria-hidden="true" height="48" viewBox="0 0 48 48" width="48">
      <circle cx="24" cy="24" fill="#ffffff" r="20.5" stroke="#0a72f6" strokeWidth="5" />
      <g fill="#0a72f6">
        <circle cx="24" cy="14.4" r="3.8" />
        <rect height="9.6" rx="2" width="4" x="22" y="19.2" />
        <rect height="3.8" rx="1.9" width="21" x="13.5" y="20.9" />
        <rect height="9.4" rx="1.9" transform="rotate(15 23.5 31.8)" width="3.7" x="21.7" y="27.1" />
        <rect height="9.4" rx="1.9" transform="rotate(-15 24.5 31.8)" width="3.7" x="22.6" y="27.1" />
      </g>
    </svg>
  </span>
}

/** Viewfinder corners around a filled camera, matching the reference window. */
function ScreenshotGlyph() {
  return <span className="computer-permission-glyph">
    <svg aria-hidden="true" height="48" viewBox="0 0 48 48" width="48">
      <g fill="none" stroke="#6f7276" strokeLinecap="round" strokeWidth="3.2">
        <path d="M4.6 15.4V9.6a5 5 0 0 1 5-5h5.8" />
        <path d="M32.6 4.6h5.8a5 5 0 0 1 5 5v5.8" />
        <path d="M43.4 32.6v5.8a5 5 0 0 1-5 5h-5.8" />
        <path d="M15.4 43.4H9.6a5 5 0 0 1-5-5v-5.8" />
      </g>
      <path d="M13.6 19.4h5.2l1.5-2.4a2.2 2.2 0 0 1 1.9-1.1h5.6a2.2 2.2 0 0 1 1.9 1.1l1.5 2.4h5.2a3.4 3.4 0 0 1 3.4 3.4v9.2a3.4 3.4 0 0 1-3.4 3.4H13.6a3.4 3.4 0 0 1-3.4-3.4v-9.2a3.4 3.4 0 0 1 3.4-3.4Z"
        fill="#6f7276" />
      <circle cx="24" cy="28.6" fill="#ffffff" r="5.5" />
      <circle cx="24" cy="28.6" fill="#6f7276" r="2.6" />
    </svg>
  </span>
}

function AllowButton({ permission, pending, onAllow }: {
  permission: GuidancePermissionKey
  pending: GuidancePermissionKey | null
  onAllow(permission: GuidancePermissionKey): void
}) {
  const label = pending === permission ? '等待系统…' : '允许'
  const disabled = pending !== null
  switch (permission) {
    case 'accessibility':
      return <button type="button" className="computer-permission-allow" disabled={disabled}
        data-testid="e2e/computer-use/guidance/allow-accessibility#button"
        onClick={() => onAllow(permission)}>{label}</button>
    case 'screenRecording':
      return <button type="button" className="computer-permission-allow" disabled={disabled}
        data-testid="e2e/computer-use/guidance/allow-screen-recording#button"
        onClick={() => onAllow(permission)}>{label}</button>
  }
}

/**
 * Standalone authorization guidance. It shares the renderer bundle with the main window and is
 * selected by the `surface` query parameter, so it must not assume any application shell around it.
 */
export function ComputerUseGuidance() {
  const [status, setStatus] = useState<ComputerPermissionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requesting, setRequesting] = useState<GuidancePermissionKey | null>(null)
  const [awaitingSystem, setAwaitingSystem] = useState(false)

  // Electron copies the shared document title into the window title bar; the reference window
  // shows no title at all, so the guidance surface clears it.
  useEffect(() => { document.title = '' }, [])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      if (!window.actionDriverDesktop?.computerUse) throw new Error('当前环境没有原生 Computer Use 服务')
      setStatus(await window.actionDriverDesktop.computerUse.permissions())
    } catch (cause) {
      setStatus(null)
      setError(cause instanceof Error ? cause.message : '权限检测失败')
    }
  }, [])

  const back = useCallback(async () => {
    try { await window.actionDriverDesktop.computerUse.closeGuidance() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法返回主窗口') }
  }, [])

  // The reference window carries no footer controls: the user grants in System Settings and
  // returns, which re-checks on focus, and Escape returns to the main window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') void back() }
    const onFocus = () => { void refresh() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('focus', onFocus)
    }
  }, [back, refresh])

  useEffect(() => { void refresh() }, [refresh])

  const allow = async (key: GuidancePermissionKey) => {
    setRequesting(key)
    setError(null)
    try {
      if (!window.actionDriverDesktop?.computerUse) throw new Error('当前环境没有原生 Computer Use 服务')
      const next = await window.actionDriverDesktop.computerUse.requestPermissions(key)
      setStatus(next)
      setAwaitingSystem(next[key] !== true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法触发系统授权')
    } finally { setRequesting(null) }
  }

  return <div className="computer-guidance-surface" data-testid="e2e/computer-use/guidance/page#page">
    <div className="computer-guidance-drag" aria-hidden="true" />
    <header className="computer-use-hero">
      <span className="computer-use-hero-icon"><ActionDriverLogo size={44} /></span>
      <h1>{`启用 ${PRODUCT_NAME} Computer Use`}</h1>
      <p>{`${PRODUCT_NAME} Computer Use 需要以下权限，才能在你的 Mac 上使用各个 App。这些权限只在你要求 ${PRODUCT_NAME} 执行任务时使用。`}</p>
    </header>
    {awaitingSystem && <p className="computer-guidance-pending"
      data-testid="e2e/computer-use/guidance/pending#status">
      <AppIcon name="monitor" size={16} />在系统设置中完成
    </p>}
    <ul className="computer-permission-list" aria-label="系统权限">
      {permissionRows.map((row) => (
        <li className="computer-permission-card" key={row.key}>
          {row.key === 'accessibility' ? <AccessibilityGlyph /> : <ScreenshotGlyph />}
          <span className="computer-permission-copy">
            <strong>{row.title}</strong>
            <span>{row.description}</span>
          </span>
          {status?.[row.key] === true
            ? <span className="computer-permission-done">已完成<AppIcon name="check" size={14} /></span>
            : <AllowButton permission={row.key} pending={requesting}
                onAllow={(key) => { void allow(key) }} />}
        </li>
      ))}
    </ul>
    {error && <p role="alert">{error}</p>}
  </div>
}
