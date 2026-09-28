import { WebMcpInvokeTool } from './commands/capability.js'
import type { AgentTransport } from './transport.js'
export interface WebMcpAnnotations {
  readOnlyHint?: boolean | undefined
  untrustedContentHint?: boolean | undefined
  consequentialHint?: boolean | undefined
}
export interface WebMcpTool {
  name: string
  call_name: string
  registration_id: string
  title?: string | undefined
  description?: string | undefined
  input_schema?: unknown
  annotations?: WebMcpAnnotations | undefined
  origin?: string | undefined
  pageUrl?: string | undefined
}
interface DescriptorInput {
  name: string
  call_name: string
  title?: string | null | undefined
  description?: string | null | undefined
  input_schema?: unknown
  annotations?: WebMcpAnnotations | null | undefined
  origin?: string | null | undefined
  pageUrl?: string | null | undefined
}
export function toWebMcpToolDescriptor(tool: DescriptorInput) {
  return {
    name: tool.name,
    call_name: tool.call_name,
    ...(tool.title == null ? {} : { title: tool.title }),
    ...(tool.description == null ? {} : { description: tool.description }),
    inputSchema: tool.input_schema,
    ...(tool.annotations == null ? {} : { annotations: tool.annotations }),
    ...(tool.origin == null ? {} : { origin: tool.origin }),
    ...(tool.pageUrl == null ? {} : { pageUrl: tool.pageUrl })
  }
}
export interface WebMcpSnapshot {
  description(): string
  call(
    name: string,
    input: unknown,
    options?: { timeoutMs?: number | null | undefined }
  ): Promise<unknown>
}
/** Internal snapshot stage. Callers must supply schema-validated tool records. */
export function createWebMcpSnapshot({
  tools,
  context
}: {
  tools: WebMcpTool[]
  context: { browserId: string; tabId: string; transport: AgentTransport }
}): Readonly<WebMcpSnapshot> {
  const captured = tools.map((tool) => ({
    name: tool.name,
    call_name: tool.call_name,
    registration_id: tool.registration_id,
    title: tool.title,
    description: tool.description,
    input_schema: tool.input_schema,
    annotations: tool.annotations,
    origin: tool.origin,
    pageUrl: tool.pageUrl
  }))
  const descriptors = captured.map(toWebMcpToolDescriptor)
  const byAlias = new Map(captured.map((tool) => [tool.call_name, tool]))
  const description =
    descriptors.length === 0
      ? 'No WebMCP tools are available in this document.'
      : [
          'WebMCP tools available in this document:',
          JSON.stringify(
            descriptors.map(({ call_name, ...descriptor }) => ({ ...descriptor, name: call_name })),
            null,
            2
          ),
          'Call tools.call(name, input) to invoke one.'
        ].join('\n')
  return Object.freeze({
    description: () => description,
    call: async (
      name: string,
      input: unknown,
      options?: { timeoutMs?: number | null | undefined }
    ) => {
      const alias = name.trim(),
        tool = byAlias.get(alias)
      if (tool == null)
        throw new Error(
          `WebMCP tool ${JSON.stringify(alias)} is not available in this snapshot. Call fetchTools() again.`
        )
      const result = await context.transport.send({
        command: WebMcpInvokeTool.create({
          browser_id: context.browserId,
          tab_id: context.tabId,
          tool_name: tool.name,
          tool_description: tool.description,
          tool_title: tool.title,
          registration_id: tool.registration_id,
          input,
          ...(options?.timeoutMs == null ? {} : { timeout_ms: options.timeoutMs })
        })
      })
      return (result as { result?: unknown }).result
    }
  })
}
