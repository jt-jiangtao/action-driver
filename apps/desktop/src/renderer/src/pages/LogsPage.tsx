import { useState } from 'react'
import { InterfaceLogsView } from '../components/logs/InterfaceLogsView'
import { ModelLogsView } from '../components/logs/ModelLogsView'
import { SettingsSidebar } from '../components/SettingsSidebar'
import type { InteractionLogService } from '../models/interaction-logs'
import type { ModelLogService } from '../models/model-log-service'

type LogLayer = 'interface' | 'model'

export function LogsPage({
  service,
  modelLogService,
  onBack,
  onOpenConnections,
  onOpenMainPrompt,
  onOpenSkills,
  autoRefreshMs = 2_000
}: {
  service: InteractionLogService
  modelLogService: ModelLogService
  onBack(): void
  onOpenConnections(): void
  onOpenMainPrompt?(): void
  onOpenSkills?(): void
  autoRefreshMs?: number
}) {
  const [layer, setLayer] = useState<LogLayer>('interface')

  return (
    <div className="settings-shell" data-testid="e2e/settings/logs/page#page">
      <SettingsSidebar
        onBack={onBack}
        active="logs"
        onOpenLogs={() => {}}
        onOpenConnections={onOpenConnections}
        {...(onOpenMainPrompt ? { onOpenMainPrompt } : {})}
        {...(onOpenSkills ? { onOpenSkills } : {})}
      />
      <main className="settings-main logs-main">
        <div className="settings-content logs-content">
          <header className="layered-logs-header">
            <div className="logs-heading">
              <h1>日志</h1>
              <p>从真实接口事件到模型自主决策链，定位每一次运行发生了什么</p>
            </div>
            <div className="layer-tabs" aria-label="日志层级">
              <button
                className={layer === 'interface' ? 'is-active' : ''}
                data-testid="e2e/settings/logs/layer/interface#button"
                type="button"
                aria-pressed={layer === 'interface'}
                onClick={() => setLayer('interface')}
              >
                接口层日志
              </button>
              <button
                className={layer === 'model' ? 'is-active' : ''}
                data-testid="e2e/settings/logs/layer/model#button"
                type="button"
                aria-pressed={layer === 'model'}
                onClick={() => setLayer('model')}
              >
                模型层日志
              </button>
            </div>
          </header>

          {layer === 'interface' ? (
            <InterfaceLogsView service={service} autoRefreshMs={autoRefreshMs} />
          ) : (
            <ModelLogsView service={modelLogService} autoRefreshMs={autoRefreshMs} />
          )}
        </div>
      </main>
    </div>
  )
}
