import { AxInputPreparationError } from './service-ax-actions.js'
import { StaleAxCaptureError } from './service-ax-state.js'

const tabId = (value: unknown) => {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  return id
}
interface Params { tab_id: unknown; browser_id?: string; content?: string; disable_diffing?: boolean; action?: any }
interface Context {
  getCurrentSessionId(): unknown
  ax: {
    capture(tabId: number, mode: string, options: { disableDiffing: boolean }, screenshot?: () => Promise<any>): Promise<any>
    validateCapture(tabId: number, result: any): void
    performAction(tabId: number, action: any): Promise<void>
  }
  security: { ensureCommandAllowed(command: { type: string; params: Params }): Promise<unknown> }
  screenshot?: (params: { browser_id?: string; tab_id: unknown }, context: Context) => Promise<any>
}
export const axCommandHandlers = {
  tab_ax_get_state: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), session = context.getCurrentSessionId()
    for (let attempt = 0;; attempt++) try {
      const result = await context.ax.capture(id, params.content ?? 'axState',
        { disableDiffing: params.disable_diffing === true || attempt > 0 },
        () => context.screenshot?.({ ...(params.browser_id == null ? {} : { browser_id: params.browser_id }), tab_id: params.tab_id }, context) ?? Promise.reject(Error('Screenshot capture was not provided')))
      await context.security.ensureCommandAllowed({ type: 'tab_ax_get_state', params })
      context.ax.validateCapture(id, result)
      if (params.content === 'screenshot' && result.screenshot_unavailable != null) throw Error(result.screenshot_unavailable)
      return result
    } catch (error) {
      if (!(error instanceof StaleAxCaptureError) || attempt > 0 || context.getCurrentSessionId() !== session) throw error
      await context.security.ensureCommandAllowed({ type: 'tab_ax_get_state', params })
      if (context.getCurrentSessionId() !== session) throw error
    }
  },
  tab_ax_action: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id)
    try { await context.ax.performAction(id, params.action) }
    catch (error) {
      if (!(error instanceof AxInputPreparationError)) throw error
      const result = await context.ax.capture(id, 'axState', { disableDiffing: false })
      await context.security.ensureCommandAllowed({ type: 'tab_ax_action', params })
      context.ax.validateCapture(id, result)
      throw new Error(`${error.message}\n\n${result.state}`, { cause: error })
    }
    return {}
  }
}
