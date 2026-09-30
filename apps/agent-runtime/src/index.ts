export const AGENT_RUNTIME_VERSION = '0.1.0'

export interface AgentRuntimeBuildInfo {
  name: '@actiondriver/agent-runtime'
  version: string
}

export function getAgentRuntimeBuildInfo(): AgentRuntimeBuildInfo {
  return {
    name: '@actiondriver/agent-runtime',
    version: AGENT_RUNTIME_VERSION
  }
}

export * from './composition-root'
export * from './agent-graph'
export * from './database'
export * from './mock-adapters'
export * from './local-adapters'
export * from './local-runtime-server'
export * from './task-projection'
export * from './model-connections/model-gateway'
export * from './native-binding'
export * from './runtime-process'
export * from './persistence-guard'
export * from './ports'
export * from './repositories'
export * from './sqlite-checkpointer'
export * from './stream-session-service'
export * from './skill-registry'
export * from './skill-invocation-service'
export * from './skill-invocation-state-machine'
export * from './tool-registry'
export * from './tool-policy'
export * from './tool-invocation-state-machine'
export * from './tool-output-collector'
export * from './tool-invocation-service'
export * from './tool-error-exposure'
