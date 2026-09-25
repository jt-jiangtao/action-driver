import { useCallback, useEffect, useState } from 'react'
import type {
  ComputerPermissionStatus
} from '../../../../shared/computer-use-contract'
import { AppIcon, type AppIconName } from '../ui/AppIcon'
import { ActionDriverLogo } from '../ActionDriverLogo'

type GuidancePermissionKey = 'accessibility' | 'screenRecording'

/**
 * Mirrors the Codex Computer Use onboarding window one to one. Kept as a single constant so the
 * product name in the copy can be changed in one place.
 */
const PRODUCT_NAME = 'Codex'

const permissionRows: Array<{
  key: GuidancePermissionKey
  icon: AppIconName
  title: string
  description: string
}> = [
  {
    key: 'accessibility',
    icon: 'accessibility',
    title: 'Accessibility',
    description: `Allows ${PRODUCT_NAME} to access app interfaces`
  },
  {
    key: 'screenRecording',
    icon: 'screenshot',
    title: 'Screenshots',
    description: `${PRODUCT_NAME} uses screenshots to know where to click`
  },
  // Posting input events is covered by the Accessibility grant; a separate row would imply a
  // permission the user cannot actually turn on by itself.
]

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
  const [checking, setChecking] = useState(false)
  const [requesting, setRequesting] = useState<GuidancePermissionKey | null>(null)
  const [awaitingSystem, setAwaitingSystem] = useState(false)

  // Electron copies the shared document title into the window title bar; the reference window
  // shows no title at all, so the guidance surface clears it.
  useEffect(() => { document.title = '' }, [])

  const refresh = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      if (!window.actionDriverDesktop?.computerUse) throw new Error('当前环境没有原生 Computer Use 服务')
      setStatus(await window.actionDriverDesktop.computerUse.permissions())
    } catch (cause) {
      setStatus(null)
      setError(cause instanceof Error ? cause.message : '权限检测失败')
    } finally { setChecking(false) }
  }, [])

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

  const openSettings = async () => {
    try { await window.actionDriverDesktop.computerUse.openSystemSettings() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开系统设置') }
  }

  const back = async () => {
    try { await window.actionDriverDesktop.computerUse.closeGuidance() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法返回主窗口') }
  }

  return <div className="computer-guidance-surface" data-testid="e2e/computer-use/guidance/page#page">
    <header className="computer-use-hero">
      <span className="computer-use-hero-icon"><ActionDriverLogo size={44} /></span>
      <h1>{`Enable ${PRODUCT_NAME} Computer Use`}</h1>
      <p>{`${PRODUCT_NAME} Computer Use needs these permissions to use apps on your Mac. These permissions are used when you ask ${PRODUCT_NAME} to perform tasks.`}</p>
    </header>
    {awaitingSystem && <p className="computer-guidance-pending"
      data-testid="e2e/computer-use/guidance/pending#status">
      <AppIcon name="monitor" size={16} />Complete in System Settings
    </p>}
    <ul className="computer-permission-list" aria-label="系统权限">
      {permissionRows.map((row) => (
        <li className="computer-permission-card" key={row.key}>
          <span className="computer-permission-icon"><AppIcon name={row.icon} size={22} /></span>
          <span className="computer-permission-copy">
            <strong>{row.title}</strong>
            <span>{row.description}</span>
          </span>
          {status?.[row.key] === true
            ? <span className="computer-permission-done">Done<AppIcon name="check" size={14} /></span>
            : <AllowButton permission={row.key} pending={requesting}
                onAllow={(key) => { void allow(key) }} />}
        </li>
      ))}
    </ul>
    {error && <p role="alert">{error}</p>}
    <div className="computer-use-settings-actions">
      <button type="button" data-testid="e2e/computer-use/guidance/open-settings#button"
        onClick={() => { void openSettings() }}>Open System Settings</button>
      <button type="button" data-testid="e2e/computer-use/guidance/recheck#button"
        disabled={checking} onClick={() => { void refresh() }}>
        {checking ? 'Checking…' : 'Check Again'}
      </button>
      <button type="button" className="computer-guidance-back"
        data-testid="e2e/computer-use/guidance/back#button"
        onClick={() => { void back() }}>Back</button>
    </div>
  </div>
}
