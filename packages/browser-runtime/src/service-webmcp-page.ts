/** Code executed in the page's isolated world. Keep these functions self-contained. */
function pageToolDescriptor(tool: any): string {
  return JSON.stringify([
    tool.name,
    tool.origin,
    tool.title,
    tool.description,
    typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema,
    tool.annotations
  ])
}

async function pageReadTools(input: {
  generation: number
  pageUrl?: string
  staleRegistrationError: string
}) {
  const modelContext = (document as any).modelContext
  if (!modelContext || typeof modelContext.getTools !== 'function' || globalThis.origin === 'null')
    return []
  const key = '__codexNativeWebMcpState'
  const state =
    Reflect.get(globalThis, key) ?? {
      handles: new Map(),
      registrationIds: new Map(),
      generation: input.generation,
      listening: false
    }
  Reflect.set(globalThis, key, state)
  if (state.generation !== input.generation) {
    if (state.generation > input.generation) throw new Error(input.staleRegistrationError)
    state.handles.clear()
    state.registrationIds = new Map()
    state.generation = input.generation
  }
  if (!state.listening) {
    modelContext.addEventListener('toolchange', () => {
      state.handles.clear()
      state.registrationIds = new Map()
    })
    state.listening = true
  }
  const registrations = state.registrationIds
  let tools: any[]
  try {
    tools = await modelContext.getTools()
  } catch (error) {
    if (
      error != null &&
      typeof error === 'object' &&
      'name' in error &&
      (error.name === 'NotAllowedError' || error.name === 'SecurityError')
    ) return []
    throw error
  }
  if (registrations !== state.registrationIds) throw new Error(input.staleRegistrationError)
  return tools
    .filter((tool) => tool.window === window && tool.origin !== 'null')
    .map((tool) => {
      const descriptor = pageToolDescriptor(tool)
      let id = registrations.get(tool.name)
      if (id != null && state.handles.get(id)?.descriptor !== descriptor) {
        state.handles.delete(id)
        id = undefined
      }
      if (id == null) {
        id = crypto.randomUUID()
        registrations.set(tool.name, id)
      }
      state.handles.set(id, { tool, descriptor })
      return {
        name: tool.name,
        call_name: tool.name + '__' + id,
        registration_id: id,
        title: tool.title,
        description: tool.description,
        input_schema:
          typeof tool.inputSchema === 'string'
            ? JSON.parse(tool.inputSchema)
            : tool.inputSchema ?? null,
        annotations: tool.annotations,
        origin: tool.origin,
        pageUrl: input.pageUrl
      }
    })
}

async function pageInvokeTool(input: {
  registrationId: string
  generation: number
  inputJson: string
  timeoutMs?: number
  staleRegistrationError: string
}) {
  const modelContext = (document as any).modelContext
  const state = Reflect.get(globalThis, '__codexNativeWebMcpState')
  const handle = state?.handles.get(input.registrationId)
  const tool = handle?.tool
  if (!modelContext || !state || !tool || state.generation !== input.generation)
    throw new Error(input.staleRegistrationError)
  if (globalThis.origin === 'null' || tool.origin === 'null')
    throw new Error('Opaque-origin WebMCP tools are not allowed.')
  const registrations = state.registrationIds
  const tools = await modelContext.getTools()
  if (
    registrations !== state.registrationIds ||
    !state.handles.has(input.registrationId) ||
    !tools.some(
      (current: any) =>
        current.window === window &&
        current.window === tool.window &&
        current.name === tool.name &&
        current.origin === tool.origin &&
        pageToolDescriptor(current) === handle.descriptor
    )
  ) throw new Error(input.staleRegistrationError)
  const arity = modelContext.executeTool.length
  if (arity !== 1 && arity !== 2)
    throw new Error('Unsupported native WebMCP executeTool signature.')
  const parsed = JSON.parse(input.inputJson)
  return await modelContext.executeTool(
    tool,
    arity === 2 ? JSON.stringify(parsed) : parsed,
    input.timeoutMs == null ? undefined : { signal: AbortSignal.timeout(input.timeoutMs) }
  )
}

/** Serialized from maintained TypeScript, never imported from the reference bundle. */
export const webMcpPageSource = [
  '"use strict";',
  pageToolDescriptor.toString(),
  pageReadTools.toString(),
  pageInvokeTool.toString(),
  'var webMcp = { readTools: pageReadTools, invokeTool: pageInvokeTool };'
].join('\n')
