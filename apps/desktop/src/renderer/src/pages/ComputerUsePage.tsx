import { useCallback, useEffect, useState } from 'react'
import type { ComputerPermissionStatus } from '../../../shared/computer-use-contract'
import { SettingsSidebar } from '../components/SettingsSidebar'

export function ComputerUsePage({ onBack, onOpenConnections, onOpenMainPrompt, onOpenSkills }: {
  onBack(): void
  onOpenConnections(): void
  onOpenMainPrompt(): void
  onOpenSkills(): void
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
  const openSettings = async () => {
    try { await window.actionDriverDesktop.computerUse.openSystemSettings() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开系统设置') }
  }
  const items = [
    { label: '辅助功能', allowed: status?.accessibility },
    { label: '屏幕与系统音频录制', allowed: status?.screenRecording }
  ]
  return <div className="settings-shell" data-testid="e2e/settings/computer-use/page#page">
    <SettingsSidebar onBack={onBack} active="computer-use"
      onOpenConnections={onOpenConnections} onOpenMainPrompt={onOpenMainPrompt}
      onOpenSkills={onOpenSkills} />
    <main className="settings-main agent-settings-main">
      <div className="agent-page computer-use-settings">
        <header className="agent-page-header"><div>
          <h1>Computer Use</h1>
          <p>在 macOS 14 或更新版本中观察并操作当前桌面。首次在任务中使用时会自动打开授权指引窗口。</p>
        </div></header>
        <section aria-label="系统权限">
          <h2>系统权限</h2>
          <p>在“系统设置 → 隐私与安全性”中，找到 <strong>{status?.permissionTarget ?? 'ActionDriver Computer Use'}</strong> 并开启所需权限；开发构建下该条目可能显示为宿主应用名。更改权限后返回这里重新检测；系统若提示退出并重新打开应用，请照做。</p>
          <ul>{items.map((item) => <li key={item.label}>{item.label}：{status ? item.allowed ? '已授权' : '未授权' : '待检测'}</li>)}</ul>
          {error && <p role="alert">{error}</p>}
          <div className="computer-use-settings-actions">
            <button type="button" data-testid="e2e/settings/computer-use/open-settings#button"
              onClick={() => { void openSettings() }}>打开系统设置</button>
            <button type="button" data-testid="e2e/settings/computer-use/recheck#button"
              disabled={checking} onClick={() => { void refresh() }}>
              {checking ? '检测中…' : '重新检测'}
            </button>
          </div>
        </section>
        <section aria-label="使用范围"><h2>使用范围</h2>
          <p>系统权限开启后，Computer Use 默认可操作所有应用。执行时应保持需要操作的窗口在前台。</p>
          <p>桌面截图与可访问性文本可能发送给所选的远端模型；截图在本机运行时仅短暂保存在内存中。</p>
        </section>
      </div>
    </main>
  </div>
}
