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

export type RegisteredTool = { definition: ToolDefinition; executor: ToolExecutor; owner?: PluginOwner }

export class RuntimeToolRegistry {
  private readonly byVersion = new Map<string, RegisteredTool>()
  private readonly byModelName = new Map<string, RegisteredTool>()

  register(definition: ToolDefinition, executor: ToolExecutor, owner?: PluginOwner): Disposable {
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

    const versionKeys = [parsed.id]
    const modelNames = [parsed.modelName]
    for (const alias of versionKeys) {
      const existing = this.byVersion.get(`${alias}@${parsed.version}`)
      if (existing && existing.definition.id !== parsed.id) throw new ToolRegistryError('TOOL_OWNER_CONFLICT', alias)
    }
    for (const alias of modelNames) {
      const existing = this.byModelName.get(alias)
      if (existing && this.key(existing.definition) !== this.key(parsed)) throw new ToolRegistryError('TOOL_MODEL_NAME_CONFLICT', alias)
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

    const registered: RegisteredTool = { definition: parsed, executor, ...(owner ? { owner: structuredClone(owner) } : {}) }
    for (const id of versionKeys) this.byVersion.set(`${id}@${parsed.version}`, registered)
    for (const name of modelNames) this.byModelName.set(name, registered)
    return { dispose: () => {
      for (const id of versionKeys) if (this.byVersion.get(`${id}@${parsed.version}`) === registered) this.byVersion.delete(`${id}@${parsed.version}`)
      for (const name of modelNames) if (this.byModelName.get(name) === registered) this.byModelName.delete(name)
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
    return [...new Set(this.byVersion.values())].map(({ definition }) => structuredClone(definition))
  }

  private key(definition: Pick<ToolDefinition, 'id' | 'version'>): string {
    return `${definition.id}@${definition.version}`
  }

  private unavailable(identity: string): ToolRegistryError {
    return new ToolRegistryError('TOOL_UNAVAILABLE', identity)
  }
}
