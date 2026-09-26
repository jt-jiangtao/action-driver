import { useCallback, useEffect, useState } from 'react'
import type { ComputerPermissionStatus } from '../../../shared/computer-use-contract'
import { ActionDriverLogo } from '../components/ActionDriverLogo'
import { ModelToggle } from '../components/ModelToggle'
import { SettingsSidebar } from '../components/SettingsSidebar'

function stateLabel(allowed: boolean | undefined): string {
  if (allowed === undefined) return '待检测'
  return allowed ? '已授权' : '未授权'
}

export function ComputerUsePage({
  onBack,
  onOpenConnections,
  onOpenMainPrompt,
  onOpenSkills,
  onOpenComputerUse
}: {
  onBack(): void
  onOpenConnections(): void
  onOpenMainPrompt(): void
  onOpenSkills(): void
  onOpenComputerUse?(): void
}) {
  const [status, setStatus] = useState<ComputerPermissionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
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

  // Controlling any app needs both grants; input events ride along with Accessibility.
  const authorized = status !== null && status.accessibility && status.screenRecording
  const openGuidance = async () => {
    try { await window.actionDriverDesktop.computerUse.ensureGuidance() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开授权指引') }
  }
  const openSystemSettings = async () => {
    try { await window.actionDriverDesktop.computerUse.openSystemSettings() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开系统设置') }
  }

  return <div className="settings-shell" data-testid="e2e/settings/computer-use/page#page">
    <SettingsSidebar onBack={onBack} active="computer-use"
      onOpenConnections={onOpenConnections} onOpenMainPrompt={onOpenMainPrompt}
      onOpenSkills={onOpenSkills}
      {...(onOpenComputerUse ? { onOpenComputerUse } : {})} />
    <main className="settings-main agent-settings-main">
      <div className="agent-page computer-use-settings">
        <header className="agent-page-header"><div>
          <h1>电脑操控</h1>
          <p>管理 ActionDriver 如何使用你电脑上的其他应用程序</p>
        </div></header>

        <section className="computer-use-group" aria-label="控制">
          <h2>控制</h2>
          <div className="computer-use-card">
            <div className="computer-use-card-row">
              <span className="computer-use-card-icon"><ActionDriverLogo size={24} /></span>
              <span className="computer-use-card-copy">
                <strong>任意应用</strong>
                <span>允许 ActionDriver 控制你电脑上的应用</span>
              </span>
              <ModelToggle
                label="任意应用"
                testId="e2e/settings/computer-use/any-app#switch"
                checked={authorized}
                onChange={() => { void (authorized ? openSystemSettings() : openGuidance()) }}
              />
            </div>
            <div className="computer-use-card-footer">
              <div className="computer-use-status">
                <span className="computer-use-status-line">
                  <span className={`computer-use-status-dot${status?.accessibility ? ' is-on' : ''}`}
                    aria-hidden="true" />
                  辅助功能{stateLabel(status?.accessibility)}
                </span>
                <span className="computer-use-status-line">
                  <span className={`computer-use-status-dot${status?.screenRecording ? ' is-on' : ''}`}
                    aria-hidden="true" />
                  屏幕录制{stateLabel(status?.screenRecording)}
                </span>
              </div>
              <button type="button" data-testid="e2e/settings/computer-use/recheck#button"
                disabled={checking} onClick={() => { void refresh() }}>
                {checking ? '检测中…' : '重新检测'}
              </button>
              {!authorized && <button type="button" className="computer-use-guidance-entry"
                data-testid="e2e/settings/computer-use/open-guidance#button"
                onClick={() => { void openGuidance() }}>打开授权指引</button>}
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
    </main>
  </div>
}
