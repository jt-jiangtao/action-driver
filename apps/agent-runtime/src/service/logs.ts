// Log reading lives in @actiondriver/observability so the service endpoint and the desktop log
// page read the same files the same way.
export * from '@actiondriver/observability'

const LOG_CONTROL_PLANE_OPERATIONS = new Set([
  'actiondriver:log:list',
  'actiondriver:log:get-detail'
])

export function isLogControlPlaneOperation(operation: string): boolean {
  return LOG_CONTROL_PLANE_OPERATIONS.has(operation)
}
