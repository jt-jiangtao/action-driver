import { randomUUID } from 'node:crypto'
import { computerHelperRequest, type ComputerHelperRequest } from '@action-driver/runtime-contracts'
import type { HostedSkillProvider } from './skill-provider-host'

type Helper = { execute(request: ComputerHelperRequest, signal?: AbortSignal): Promise<unknown> }

export function createComputerUseProvider(helper: Helper): HostedSkillProvider {
  return {
    skillId: 'computer-use',
    providerId: 'native.computer-use',
    providerVersion: '1.0.0',
    async execute(input: unknown, signal?: AbortSignal): Promise<unknown> {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('INVALID_REQUEST: Computer Use input must be an object')
      }
      const request = computerHelperRequest.safeParse({
        ...input,
        version: 1,
        requestId: randomUUID(),
        deadlineUnixMs: Date.now() + 25_000
      })
      if (!request.success ||
          // The JavaScript entry drives the app-addressed surface: policy, supervision and state.
          // `permissions` and `guidance` stay desktop-only, and `observe`/`capture` are gone (4.1).
          !['act', 'list-apps', 'app-state', 'app-policy', 'session-start', 'session-end']
            .includes(request.data.operation)) {
        throw new Error('INVALID_REQUEST: Unsupported Computer Use command')
      }
      return helper.execute(request.data, signal)
    }
  }
}
