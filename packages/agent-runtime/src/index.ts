export const AGENT_RUNTIME_VERSION = '0.1.0'

export interface AgentRuntimeBuildInfo {
  name: '@action-driver/agent-runtime'
  version: string
}

export function getAgentRuntimeBuildInfo(): AgentRuntimeBuildInfo {
  return { name: '@action-driver/agent-runtime', version: AGENT_RUNTIME_VERSION }
}

export * from './agent-graph'
export * from './execution-errors'
export * from './host-ports'
export * from './model-credential-key'
export * from './model-trace-port'
export * from './ports'
export * from './task-projection'
export * from './skill-invocation-service'
export * from './skill-invocation-state-machine'
export * from './skill-registry'
export * from './tool-invocation-service'
export * from './tool-invocation-state-machine'
export * from './tool-activity'
export * from './tool-error-exposure'
export * from './tool-output-collector'
export * from './tool-policy'
export * from './tool-registry'
export * from './tool-result-redaction'
export * from './stream-session-service'
export * from './stream/event-delivery'
export * from './stream/stream-snapshot'
export * from './stream/stream-values'
export * from './model-gateway'
