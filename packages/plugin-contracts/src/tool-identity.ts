/** Target identifies execution-context ownership, not whether a tool uses the network. */
export type ToolTarget = 'local' | 'cloud'
export function createToolIdentity(target: ToolTarget, pluginId: string, operation: string) {
  const segment = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
  if (!['local', 'cloud'].includes(target) || !segment.test(pluginId) || !operation.split(/[./]/).every(part => segment.test(part))) throw new Error('Invalid qualified tool identity')
  const capabilityId = `${pluginId}/${operation.replaceAll('.', '/')}`
  const id = `tools/${target}/${capabilityId}`
  return { id, modelName: id.replace(/[/-]/g, '_'), capabilityId }
}
