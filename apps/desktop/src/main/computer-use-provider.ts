import { randomUUID } from 'node:crypto'
import { computerHelperRequest, type ComputerHelperRequest } from '@actiondriver/runtime-contracts'
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
          !['permissions', 'observe', 'capture', 'act', 'list-apps', 'app-state']
            .includes(request.data.operation)) {
        throw new Error('INVALID_REQUEST: Unsupported Computer Use command')
      }
      return helper.execute(request.data, signal)
    }
  }
}
