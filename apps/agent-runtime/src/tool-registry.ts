import {
  parseToolDefinition,
  type ToolDefinition,
  type ToolExecutor
} from '@actiondriver/runtime-contracts'

export class ToolRegistryError extends Error {
  constructor(
    readonly code: 'TOOL_DEFINITION_INVALID' | 'TOOL_MODEL_NAME_CONFLICT' | 'TOOL_UNAVAILABLE',
    message: string
  ) {
    super(`${code}: ${message}`)
    this.name = 'ToolRegistryError'
  }
}

export type RegisteredTool = { definition: ToolDefinition; executor: ToolExecutor }

export class RuntimeToolRegistry {
  private readonly byVersion = new Map<string, RegisteredTool>()
  private readonly byModelName = new Map<string, RegisteredTool>()

  register(definition: ToolDefinition, executor: ToolExecutor): void {
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

    const existingName = this.byModelName.get(parsed.modelName)
    if (existingName && this.key(existingName.definition) !== this.key(parsed)) {
      throw new ToolRegistryError(
        'TOOL_MODEL_NAME_CONFLICT',
        `${parsed.modelName} is already registered by ${existingName.definition.id}@${existingName.definition.version}`
      )
    }

    const registered = { definition: parsed, executor }
    this.byVersion.set(this.key(parsed), registered)
    this.byModelName.set(parsed.modelName, registered)
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
    return [...this.byVersion.values()].map(({ definition }) => structuredClone(definition))
  }

  private key(definition: Pick<ToolDefinition, 'id' | 'version'>): string {
    return `${definition.id}@${definition.version}`
  }

  private unavailable(identity: string): ToolRegistryError {
    return new ToolRegistryError('TOOL_UNAVAILABLE', identity)
  }
}
