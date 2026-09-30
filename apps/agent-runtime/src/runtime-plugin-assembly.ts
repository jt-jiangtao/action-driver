import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { IMAGE_GENERATION_TOOL_ID } from '@actiondriver/contracts'
import { PluginError } from '@actiondriver/plugin-contracts'
import { definition as imageDefinition } from '@actiondriver/image-generation-plugin/catalog'
import { createWorkspaceDependenciesTool } from './execution/workspace-dependencies-tool'
import { createWebCredentialPort } from './plugins/web-credentials'
import { createRuntimePluginPlatform } from './plugins/composition'
import { createPluginArtifactHostPorts } from './resources/plugin-resources'
import { createDesktopResourcePort } from './plugins/desktop-resource-port'
import { createCommandExecutionPort } from './plugins/command-port'
import { createSkillStoragePorts } from './plugins/skill-port'
import { extractPageTextIsolated } from './web-open/extract-isolated'
import type { createLocalRuntimeAdapters } from './local-adapters'
import type { createRuntimeStorage } from './runtime-storage'
import type { createRuntimeExecutionEnvironment } from './runtime-execution'
import type { SessionExecutionContextResolver } from './execution/session-execution-context'
import type { PluginInstructionHost } from './plugins/instruction-host'
import type { AgentFileStore } from './agent-files/agent-file-store'
import type { SkillInstaller } from './agent-files/skill-installer'
import type { LoadedSkills } from './computer-use/skill-gate'
import type { createComputerUseEntry } from './computer-use/entry'

export async function createRuntimePluginAssembly(options: {
  dataRoot: string
  environment: NodeJS.ProcessEnv
  execution: Awaited<ReturnType<typeof createRuntimeExecutionEnvironment>>
  storage: Awaited<ReturnType<typeof createRuntimeStorage>>
  local: ReturnType<typeof createLocalRuntimeAdapters>
  executionContexts: SessionExecutionContextResolver
  pluginInstructions: PluginInstructionHost
  agentFiles: AgentFileStore
  skillInstaller: SkillInstaller
  loadedSkills: LoadedSkills
  computer: Awaited<ReturnType<typeof createComputerUseEntry>> | null
}) {
  const {
    dataRoot,
    environment,
    execution,
    storage,
    local,
    executionContexts,
    pluginInstructions,
    agentFiles,
    skillInstaller,
    loadedSkills,
    computer
  } = options
  const { runtimeDist, runtimePaths, scriptTools } = execution
  const { service, resources, resourceRegistry, repositories, assets } = storage
  for (const tool of scriptTools) {
    local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
  }
  const workspaceDependenciesTool = createWorkspaceDependenciesTool(runtimeDist)
  local.toolRuntime.grants.push(
    `${workspaceDependenciesTool.definition.id}@${workspaceDependenciesTool.definition.version}`
  )
  local.toolRuntime.grants.push(`${imageDefinition.id}@${imageDefinition.version}`)
  const webCredentials = createWebCredentialPort(environment)
  local.toolRuntime.isAvailable = async (definition) => {
    if (definition.id === 'tools/local/web/search')
      return webCredentials.configuration.searchConfigured
    if (definition.id === 'tools/local/web/open')
      return webCredentials.configuration.readerConfigured
    if (definition.id === imageDefinition.id) return (await service.getDefaultImageModel()) !== null
    if (definition.id === 'tools/local/cua/js' || definition.id === 'tools/local/cua/reset') {
      for (const skillId of ['browser-use', 'computer-use']) {
        try {
          local.adapters.skillRegistry.resolve(skillId, 1)
          return true
        } catch {
          /* try the other owned surface */
        }
      }
      return false
    }
    return true
  }
  local.toolRuntime.capabilityNotice = async () =>
    (await service.getDefaultImageModel()) === null
      ? '本应用支持图片生成，但当前没有配置默认生图模型。若用户请求生成图片，请说明需前往“设置 → 模型连接”启用一个模型的图片生成能力并设为默认模型；不要说应用完全没有生图工具。'
      : null
  let computerActivated = false
  const pluginPlatform = await createRuntimePluginPlatform({
    node: runtimePaths.node,
    hostEntry: join(runtimeDist, 'plugin-host.mjs'),
    packageRoots: [
      'command',
      'web',
      'image-generation',
      'skills',
      'documents',
      'pdf',
      'presentations',
      'spreadsheets',
      ...(computer ? ['computer-use'] : []),
      ...(process.platform === 'darwin' ? ['browser-use'] : [])
    ].map((id) => join(runtimeDist, 'plugins', id)),
    dataRoot: join(dataRoot, 'plugins'),
    registry: local.toolRuntime.registry,
    retiredPluginIds: ['search', 'web-reader'],
    configuration: { web: webCredentials.configuration },
    apiPorts: {
      credentials: webCredentials.credentials,
      // Plugin artifacts are host-owned resources, so a plugin always goes through the unified
      // resource entry point instead of writing into a local directory of its own choosing.
      artifacts: createPluginArtifactHostPorts({
        store: resources.pluginStore,
        readResource: (uri, _authority, context) => resourceRegistry.read(uri, context),
        ids: randomUUID
      })
    },
    skills: {
      stage: (owner, skill, root) => pluginInstructions.stage(owner, skill, root),
      publish: (owner, id) => {
        const registration = pluginInstructions.publish(owner, id)
        return {
          dispose: () => {
            loadedSkills.forget(id)
            return registration.dispose()
          }
        }
      }
    },
    desktopResources: createDesktopResourcePort(local.adapters.skillRegistry, randomUUID),
    // Desktop-initiated menu commands resolve their grants from the persisted task, never from
    // the request body.
    commandAuthority: async (request) => {
      if (!request.taskId) return { grants: [], taskId: '', sessionId: '' }
      const context = await executionContexts.resolve(request.taskId)
      return { grants: context.grants ?? [], taskId: context.taskId, sessionId: context.sessionId }
    },
    toolTimeouts: Object.fromEntries(
      scriptTools.map((tool) => [tool.definition.id, tool.definition.timeoutMs])
    ),
    hostCapabilities: {
      ...createSkillStoragePorts({
        store: agentFiles,
        installer: skillInstaller,
        contexts: executionContexts,
        record: (sessionId, skillId) => loadedSkills.record(sessionId, skillId)
      }),
      ...(computer
        ? {
            'host.computer.execute': {
              plugins: ['computer-use'],
              grants: ['tools/local/cua/js@1', 'tools/local/cua/reset@1'],
              async start() {
                if (computerActivated) await computer!.restart()
                computerActivated = true
                return { dispose: () => computer!.dispose() }
              },
              stream: (input, context, signal) =>
                createCommandExecutionPort(computer!.tools, executionContexts, [
                  'computer-use'
                ]).stream(input, context, signal)
            }
          }
        : {}),
      'host.image.model': {
        plugins: ['image-generation'],
        grants: [`${IMAGE_GENERATION_TOOL_ID}@1`],
        async invoke() {
          const model = await service.getDefaultImageModel()
          return model ? { ...model } : null
        }
      },
      'host.image.generate': {
        plugins: ['image-generation'],
        grants: [`${IMAGE_GENERATION_TOOL_ID}@1`],
        async invoke(input, context, signal) {
          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            typeof input.prompt !== 'string' ||
            !input.prompt.trim() ||
            input.prompt.length > 4000 ||
            !context.taskId
          )
            throw new PluginError('TOOL_INPUT_INVALID', 'Invalid image request')
          const task = await repositories.tasks.get(context.taskId)
          if (!task || task.sessionId !== context.sessionId)
            throw new PluginError('IMAGE_SESSION_NOT_FOUND', 'Image task has no owned session')
          const model = await service.getDefaultImageModel()
          if (!model) throw new PluginError('IMAGE_MODEL_NOT_CONFIGURED', 'No default image model')
          const selected = input.model
          if (
            !selected ||
            typeof selected !== 'object' ||
            Array.isArray(selected) ||
            selected.connectionId !== model.connectionId ||
            selected.modelId !== model.modelId
          )
            throw new PluginError('AUTHORIZATION_DENIED', 'Image model selection changed')
          const bytes = await service.generateImage({ model, prompt: input.prompt }, signal)
          signal.throwIfAborted()
          return { ...(await assets.saveGenerated(task.sessionId, bytes)) }
        }
      },
      'host.command.execute': createCommandExecutionPort(
        [...scriptTools, workspaceDependenciesTool],
        executionContexts
      ),
      'host.web.extract': {
        plugins: ['web'],
        grants: ['tools/local/web/open@1'],
        async invoke(input, _context, signal) {
          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            typeof input.html !== 'string' ||
            Buffer.byteLength(input.html) > 4 * 1024 * 1024 ||
            typeof input.url !== 'string' ||
            input.url.length > 2048
          )
            throw new PluginError('TOOL_INPUT_INVALID', 'Invalid bounded HTML input')
          return { ...(await extractPageTextIsolated(input.html, input.url, { signal })) }
        }
      }
    },
    now: Date.now,
    ids: randomUUID,
    log: (entry) => console.error('[plugin]', JSON.stringify(entry))
  })
  if (webCredentials.configuration.searchConfigured) {
    // Tool grants remain host-owned; a plugin never authorizes itself.
    local.toolRuntime.grants.push('tools/local/web/search@1')
  }
  await Promise.all(
    [
      'command',
      'image-generation',
      'web',
      'skills',
      'documents',
      'pdf',
      'presentations',
      'spreadsheets',
      ...(computer ? ['computer-use'] : []),
      ...(process.platform === 'darwin' ? ['browser-use'] : [])
    ].map((id) => pluginPlatform.enable(id))
  )
  if (webCredentials.configuration.readerConfigured)
    local.toolRuntime.grants.push('tools/local/web/open@1')
  local.toolRuntime.grants.push('tools/local/skills/read@1', 'tools/local/skills/install@1')
  return pluginPlatform
}
