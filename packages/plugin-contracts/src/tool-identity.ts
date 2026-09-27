/** Target identifies execution-context ownership, not whether a tool uses the network. */
export type ToolTarget = 'local' | 'cloud'
export function createToolIdentity(target: ToolTarget, pluginId: string, operation: string) {
  if (!['local', 'cloud'].includes(target) || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(pluginId) || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(operation)) throw new Error('Invalid qualified tool identity')
  const capabilityId = `${pluginId}.${operation}`
  const id = `tools.${target}.${capabilityId}`
  return { id, modelName: id, capabilityId }
}
