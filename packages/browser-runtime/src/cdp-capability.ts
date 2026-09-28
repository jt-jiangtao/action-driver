import { TabCdpCommands } from './commands/structured.js'
import type { z } from 'zod/v3'
import { TabCapability } from './capabilities.js'
import type { TabCapabilityOptions } from './capabilities.js'
export interface CdpTarget {
  sessionId?: string | undefined
  targetId?: string | undefined
}
export interface CdpSendOptions {
  target?: CdpTarget | null | undefined
  timeoutMs?: number | undefined
}
export interface CdpEventOptions extends CdpSendOptions {
  afterSequence?: number | undefined
  limit?: number | undefined
  methods?: string[] | undefined
}
export type CdpEventResult = z.infer<typeof TabCdpCommands.Events.ResultSchema>
function normalizeTarget(target: CdpTarget | null | undefined) {
  if (target != null) return { session_id: target.sessionId, target_id: target.targetId }
}
function eventTimeout(timeout: number | undefined) {
  return timeout != null && timeout > 0 ? timeout + 2000 : undefined
}
export class CdpTabCapability extends TabCapability {
  constructor({ browserId, documentation, info, tabId, transport }: TabCapabilityOptions) {
    super(transport, browserId, tabId, documentation, info)
  }
  async send(
    method: string,
    params?: Record<string, unknown>,
    options?: CdpSendOptions
  ): Promise<unknown> {
    const result = await this.transport.send({
      command: TabCdpCommands.Call.create({
        browser_id: this.browserId,
        method,
        params,
        tab_id: this.tabId,
        target: normalizeTarget(options?.target),
        timeout_ms: options?.timeoutMs
      }),
      timeoutMs: options?.timeoutMs
    })
    return TabCdpCommands.Call.ResultSchema.parse(result)
  }
  async readEvents(options?: CdpEventOptions): Promise<CdpEventResult> {
    const result = await this.transport.send({
      command: TabCdpCommands.Events.create({
        after_sequence: options?.afterSequence,
        browser_id: this.browserId,
        limit: options?.limit,
        methods: options?.methods,
        tab_id: this.tabId,
        target: normalizeTarget(options?.target),
        timeout_ms: options?.timeoutMs
      }),
      timeoutMs: eventTimeout(options?.timeoutMs)
    })
    return TabCdpCommands.Events.ResultSchema.parse(result)
  }
}
