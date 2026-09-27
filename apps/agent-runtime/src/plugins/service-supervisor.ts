import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { PluginError, serviceDefinitionSchema, type Json, type PluginOwner, type ServiceDefinition } from '@actiondriver/plugin-contracts'
import type { Disposable } from '@actiondriver/plugin-sdk'
export interface SupervisedService extends Disposable {
  isAvailable(): boolean
  tools(): { name: string; description?: string; inputSchema: Record<string, unknown> }[]
  call(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<Json>
  onExit(handler: () => void): void
}
export interface ServiceSupervisorOptions {
  node: string; platform: string
  log(owner: PluginOwner, stream: 'stdout' | 'stderr', text: string): void
  credentials?(owner: PluginOwner, url: string): Promise<Record<string, string>>
}
export class NodeServiceSupervisor {
  constructor(private readonly options: ServiceSupervisorOptions) {}
  async start(input: ServiceDefinition, owner: PluginOwner, root: string): Promise<SupervisedService> {
    const service = serviceDefinitionSchema.parse(input)
    const native = service.kind === 'native' || service.runtime === 'native'
    let executable = this.options.node, args = service.args ?? []
    if (service.kind !== 'mcp-http') {
      const entry = native ? service.artifacts?.[this.options.platform] : service.entry
      if (!entry) throw new PluginError('PLATFORM_UNAVAILABLE', `${service.id}: missing ${this.options.platform} artifact`)
      const canonicalRoot = await realpath(root), path = await realpath(resolve(root, entry)).catch(() => { throw new PluginError('PLATFORM_UNAVAILABLE', `${service.id}: missing ${entry}`) })
      if (relative(canonicalRoot, path).startsWith('..') || !(await stat(path)).isFile()) throw new PluginError('INVALID_MANIFEST', `${service.id}: entry outside package`)
      if (native) { await access(path, constants.X_OK); executable = path } else args = [path, ...args]
    }
    if (service.kind === 'mcp-stdio' || service.kind === 'mcp-http') {
      const client = new Client({ name: `actiondriver-${owner.pluginId}`, version: owner.version })
      const transport = service.kind === 'mcp-stdio'
        ? new StdioClientTransport({ command: executable, args, env: {}, cwd: root, stderr: 'pipe' })
        : new StreamableHTTPClientTransport(new URL(service.url ?? ''), { requestInit: { headers: await this.options.credentials?.(owner, service.url ?? '') ?? {} } })
      let live = true, closing = false
      const listeners = new Set<() => void>()
      const lost = () => { live = false; if (!closing) for (const listener of listeners) listener() }
      client.onclose = lost
      let protocolError!: (error: Error) => void
      const malformed = new Promise<never>((_resolve, reject) => { protocolError = reject })
      client.onerror = error => { protocolError(new PluginError('PROTOCOL_ERROR', error.message)); void client.close(); lost() }
      try {
        await Promise.race([client.connect(transport as Parameters<Client['connect']>[0], { timeout: 5000 }), malformed])
        if (transport instanceof StdioClientTransport) transport.stderr?.on('data', chunk => this.options.log(owner, 'stderr', chunk.toString().slice(0, 4096)))
        const catalog = await client.listTools()
        return {
          isAvailable: () => live,
          tools: () => live ? catalog.tools.map(tool => ({ name: tool.name, inputSchema: structuredClone(tool.inputSchema), ...(tool.description !== undefined ? { description: tool.description } : {}) })) : [],
          onExit: handler => { listeners.add(handler) },
          call: async (name, arguments_, signal) => {
            if (!live) throw new PluginError('UNAVAILABLE', service.id)
            try { return JSON.parse(JSON.stringify(await client.callTool({ name, arguments: arguments_ }, undefined, { signal }))) as Json }
            catch (error) {
              if (!live || signal.aborted) throw new PluginError('RESULT_UNKNOWN', `${service.id}: ${String(error)}`)
              throw error
            }
          },
          dispose: async () => { if (closing) return; closing = true; live = false; await client.close() }
        }
      } catch (error) { closing = true; live = false; await client.close(); throw error }
    }
    let live = false, closing = false, attempts = 0
    let child: ReturnType<typeof spawn>
    let restartTimer: ReturnType<typeof setTimeout> | undefined
    const listeners = new Set<() => void>()
    const launch = () => {
      child = spawn(executable, args, { cwd: root, env: {}, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout?.on('data', chunk => this.options.log(owner, 'stdout', chunk.toString().slice(0, 4096)))
      child.stderr?.on('data', chunk => this.options.log(owner, 'stderr', chunk.toString().slice(0, 4096)))
      child.on('error', () => { live = false })
      child.once('spawn', () => { live = true })
      child.once('exit', () => {
        live = false
        if (closing) return
        if (attempts++ < (service.restart?.attempts ?? 0)) restartTimer = setTimeout(launch, service.restart?.backoffMs ?? 100)
        else for (const listener of listeners) listener()
      })
    }
    launch()
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    return {
      isAvailable: () => live, tools: () => [], onExit: handler => { listeners.add(handler) },
      call: async () => { throw new PluginError('UNAVAILABLE', 'Service does not declare an RPC transport') },
      dispose: async () => {
        if (closing) return
        closing = true; live = false; if (restartTimer) clearTimeout(restartTimer)
        if (child.exitCode !== null || child.signalCode !== null) return
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
          child.kill('SIGTERM')
        })
      }
    }
  }
}
