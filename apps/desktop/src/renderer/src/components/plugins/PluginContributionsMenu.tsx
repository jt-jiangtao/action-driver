import { useEffect, useState } from 'react'
import type { PluginUiContributions } from '@actiondriver/plugin-contracts'
import { useOptionalAppServices } from '../../di/services-context'
import { e2eId } from '../../testing/e2e-id'

const EMPTY: PluginUiContributions = { views: [], menus: [] }

/**
 * Host-owned entry point for declarative plugin surfaces: views open in their declared container
 * and menu entries only invoke a declared command. Availability comes from the runtime projection,
 * and the runtime re-checks the same condition and the task grants when the command runs.
 */
export function PluginContributionsMenu({ taskId }: { taskId?: string }) {
  const services = useOptionalAppServices()
  const pluginContributions = services?.pluginContributions ?? null
  const [contributions, setContributions] = useState<PluginUiContributions>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!pluginContributions) return
    let live = true
    pluginContributions.list().then(
      (next) => { if (live) setContributions(next) },
      (reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) }
    )
    return () => { live = false }
  }, [pluginContributions])
  if (!pluginContributions) return null
  const openView = (pluginId: string, viewId: string) => {
    void pluginContributions.openView(pluginId, viewId).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }
  const runCommand = (pluginId: string, commandId: string) => {
    void pluginContributions.executeCommand({ pluginId, commandId, ...(taskId ? { taskId } : {}) }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }
  if (error) return <p className="plugin-contributions-error" role="status">{error}</p>
  return (
    <section className="plugin-contributions" aria-label="插件" data-testid="e2e/shared/sidebar/plugin-contributions#nav">
      {contributions.views.map((view) => (
        <button
          key={`view:${view.pluginId}:${view.definition.id}`}
          type="button"
          className="plugin-contribution-entry"
          data-testid={e2eId('e2e/shared/sidebar/plugin-view/:contribution#button', { contribution: view.definition.id })}
          disabled={!view.available}
          onClick={() => openView(view.pluginId, view.definition.id)}
        >
          {view.definition.title}
        </button>
      ))}
      {contributions.menus.map((menu) => (
        <button
          key={`menu:${menu.pluginId}:${menu.definition.id}`}
          type="button"
          className="plugin-contribution-entry"
          data-testid={e2eId('e2e/shared/sidebar/plugin-menu/:contribution#button', { contribution: menu.definition.id })}
          disabled={!menu.available}
          onClick={() => runCommand(menu.pluginId, menu.definition.command)}
        >
          {menu.definition.title}
        </button>
      ))}
    </section>
  )
}
