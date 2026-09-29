import { type PluginOwner } from '@actiondriver/plugin-contracts'
import type { Disposable } from '@actiondriver/plugin-sdk'
import {
  parseToolDefinition,
  type ToolDefinition,
  type ToolExecutor
} from '@actiondriver/runtime-contracts'

export class ToolRegistryError extends Error {
  constructor(
    readonly code: 'TOOL_DEFINITION_INVALID' | 'TOOL_MODEL_NAME_CONFLICT' | 'TOOL_UNAVAILABLE' | 'TOOL_OWNER_CONFLICT',
    message: string
  ) {
    super(`${code}: ${message}`)
    this.name = 'ToolRegistryError'
  }
}

export type RegisteredTool = { definition: ToolDefinition; executor: ToolExecutor; owner?: PluginOwner; isAvailable?: () => boolean }

export class RuntimeToolRegistry {
  private readonly byVersion = new Map<string, RegisteredTool>()
  private readonly byModelName = new Map<string, RegisteredTool>()

  register(definition: ToolDefinition, executor: ToolExecutor, owner?: PluginOwner, isAvailable?: () => boolean): Disposable {
    let parsed: ToolDefinition
    try {
      parsed = parseToolDefinition(definition)
      JSON.stringify(parsed.inputSchema)
    } catch (error) {
      throw new ToolRegistryError(
        'TOOL_DEFINITION_INVALID',
        error instanceof Error ? error.message : String(error)
      )
    }

    const existingVersion = this.byVersion.get(this.key(parsed))
    if (existingVersion && (owner || existingVersion.owner)) throw new ToolRegistryError('TOOL_OWNER_CONFLICT', `${parsed.id}: ${existingVersion.owner?.pluginId ?? 'runtime'} conflicts with ${owner?.pluginId ?? 'runtime'}`)
    const existingName = this.byModelName.get(parsed.modelName)
    if (existingName && this.key(existingName.definition) !== this.key(parsed)) {
      throw new ToolRegistryError(
        'TOOL_MODEL_NAME_CONFLICT',
        `${parsed.modelName} is already registered by ${existingName.definition.id}@${existingName.definition.version}`
      )
    }

    const registered: RegisteredTool = { definition: parsed, executor, ...(owner ? { owner: structuredClone(owner) } : {}), ...(isAvailable ? { isAvailable } : {}) }
    this.byVersion.set(this.key(parsed), registered)
    this.byModelName.set(parsed.modelName, registered)
    return { dispose: () => {
      if (this.byVersion.get(this.key(parsed)) === registered) this.byVersion.delete(this.key(parsed))
      if (this.byModelName.get(parsed.modelName) === registered) this.byModelName.delete(parsed.modelName)
    } }
  }

  resolve(id: string, version: number): RegisteredTool {
    const registered = this.byVersion.get(`${id}@${version}`)
    if (!registered) throw this.unavailable(`${id}@${version}`)
    return registered
  }

  resolveModelName(modelName: string): RegisteredTool {
    const registered = this.byModelName.get(modelName)
    if (!registered) throw this.unavailable(modelName)
    return registered
  }

  list(): ToolDefinition[] {
    return [...new Set(this.byVersion.values())].filter(tool => tool.isAvailable?.() ?? true).map(({ definition }) => structuredClone(definition))
  }

  private key(definition: Pick<ToolDefinition, 'id' | 'version'>): string {
    return `${definition.id}@${definition.version}`
  }

  private unavailable(identity: string): ToolRegistryError {
    return new ToolRegistryError('TOOL_UNAVAILABLE', identity)
  }
}
