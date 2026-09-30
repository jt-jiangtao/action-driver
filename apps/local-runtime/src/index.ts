export const LOCAL_RUNTIME_VERSION = '0.1.0'

export interface LocalRuntimeBuildInfo {
  name: '@action-driver/local-runtime'
  version: string
}

export function getLocalRuntimeBuildInfo(): LocalRuntimeBuildInfo {
  return {
    name: '@action-driver/local-runtime',
    version: LOCAL_RUNTIME_VERSION
  }
}

export * from './composition-root'
export * from '@action-driver/agent-runtime/agent-graph'
export * from './database'
export * from './mock-adapters'
export * from './local-adapters'
export * from './local-runtime-server'
export * from '@action-driver/agent-runtime/task-projection'
export * from '@action-driver/agent-runtime/model-gateway'
export * from './native-binding'
export * from './runtime-process'
export * from './persistence-guard'
export * from '@action-driver/agent-runtime/ports'
export * from './repositories'
export * from './sqlite-checkpointer'
export * from '@action-driver/agent-runtime/stream-session-service'
export * from '@action-driver/agent-runtime/skill-registry'
export * from '@action-driver/agent-runtime/skill-invocation-service'
export * from '@action-driver/agent-runtime/skill-invocation-state-machine'
export * from '@action-driver/agent-runtime/tool-registry'
export * from '@action-driver/agent-runtime/tool-policy'
export * from '@action-driver/agent-runtime/tool-invocation-state-machine'
export * from '@action-driver/agent-runtime/tool-output-collector'
export * from '@action-driver/agent-runtime/tool-invocation-service'
export * from '@action-driver/agent-runtime/tool-error-exposure'
