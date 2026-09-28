/** Target identifies execution-context ownership, not whether a tool uses the network. */
export type ToolTarget = 'local' | 'cloud'
export function createToolIdentity(target: ToolTarget, pluginId: string, operation: string) {
  if (!['local', 'cloud'].includes(target) || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(pluginId) || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(operation)) throw new Error('Invalid qualified tool identity')
  const capabilityId = `${pluginId}.${operation}`
  const id = `tools.${target}.${capabilityId}`
  return { id, modelName: id.replace(/[.-]/g, '_'), capabilityId }
}
// Compatibility is deliberately limited to the original local built-ins. No inferred cloud route.
const legacy = [
  ['local.shell.run', 'shell_run', 'command', 'shell.run'],
  ['local.python.run', 'python_run', 'command', 'python.run'],
  ['local.node.run', 'node_run', 'command', 'node.run'],
  ['local.typescript.run', 'ts_run', 'command', 'typescript.run'],
  ['web.search', 'web_search', 'web', 'search'],
  ['web.open', 'web_open', 'web', 'open'],
  ['skill.read', 'skill_read', 'skills', 'read'],
  ['skill.install', 'skill_install', 'skills', 'install'],
  ['image.generate', 'image_generate', 'image-generation', 'generate'],
  ['workspace.dependencies.load', 'load_workspace_dependencies', 'command', 'dependencies.load'],
  ['computer.js', 'js', 'cua', 'js'],
  ['computer.js_reset', 'js_reset', 'cua', 'reset']
] as const
const identities = legacy.map(([id, modelName, plugin, operation]) => ({ legacyId: id, legacyModelName: modelName, ...createToolIdentity('local', plugin, operation) }))
export function canonicalToolId(value: string): string {
  const match = value.match(/^(.*?)(@\d+)?$/)!
  const identity = identities.find(item => item.legacyId === match[1])
  return identity ? `${identity.id}${match[2] ?? ''}` : value
}
export function canonicalModelName(value: string): string {
  return identities.find(item => item.legacyModelName === value)?.modelName ?? value
}
export function legacyToolAliases(id: string): string[] {
  return identities.filter(item => item.id === id).map(item => item.legacyId)
}
export function legacyModelAliases(modelName: string): string[] {
  return identities.filter(item => item.modelName === modelName).map(item => item.legacyModelName)
}
