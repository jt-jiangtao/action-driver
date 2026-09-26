import {
  computerHelperRequest,
  type ComputerHelperRequest,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutor,
  type ToolExecutorEvent
} from '@actiondriver/runtime-contracts'
import type { ComputerUseControlGate } from './control-gate'

type Operation = 'permissions' | 'observe' | 'capture' | 'act'
type Input = Pick<ComputerHelperRequest, 'operation'> & Record<string, unknown>
type Registered = { definition: ToolDefinition; executor: ToolExecutor }

type Json = Parameters<NonNullable<ToolExecutor['redactForPersistence']>>[1]
type JsonRecord = { [key: string]: Json }

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Copies only the listed keys that are present, so absent fields stay absent. */
function pick(value: JsonRecord, keys: readonly string[]): JsonRecord {
  const picked: JsonRecord = {}
  for (const key of keys) if (key in value) picked[key] = value[key]!
  return picked
}

function countElements(node: Json): number {
  if (!isRecord(node)) return 0
  const children = Array.isArray(node.children) ? node.children : []
  return 1 + children.reduce<number>((total, child) => total + countElements(child), 0)
}

/**
 * Screen content, element trees and coordinates stay in memory for the model; history and
 * events only keep the observation handle and a safe summary (computer-use spec, data handling).
 */
function redact(operation: Operation, kind: 'input' | 'output', value: Json): Json {
  if (!isRecord(value)) return value
  if (kind === 'input') {
    if (operation !== 'act') return value
    const action = isRecord(value.action) ? value.action : {}
    const safeAction: JsonRecord = pick(action, ['type', 'elementRef', 'key', 'modifiers',
      'milliseconds'])
    if (typeof action.text === 'string') safeAction.textLength = action.text.length
    return { ...pick(value, ['observationId']), action: safeAction }
  }
  switch (operation) {
    case 'observe': {
      const application = isRecord(value.application) ? pick(value.application, ['name']) : undefined
      return {
        ...pick(value, ['observationId']),
        ...(application ? { application } : {}),
        elementCount: countElements(value.tree ?? null),
        ...pick(value, ['truncated'])
      }
    }
    case 'capture':
      return pick(value, ['observationId', 'mimeType', 'width', 'height', 'screenshot'])
    case 'act':
      return pick(value, ['executed', 'application'])
    case 'permissions':
      return value
  }
}

const actionSchema = {
  oneOf: [
    { type: 'object', properties: { type: { const: 'click' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['type', 'x', 'y'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'click-element' }, elementRef: { type: 'string' } }, required: ['type', 'elementRef'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'type' }, text: { type: 'string' } }, required: ['type', 'text'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'key' }, key: { type: 'string' }, modifiers: { type: 'array', items: { enum: ['command', 'control', 'option', 'shift'] } } }, required: ['type', 'key', 'modifiers'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'scroll' }, deltaX: { type: 'number' }, deltaY: { type: 'number' } }, required: ['type', 'deltaX', 'deltaY'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'wait' }, milliseconds: { type: 'integer' } }, required: ['type', 'milliseconds'], additionalProperties: false }
    ,
    { type: 'object', properties: { type: { const: 'set-value' }, elementRef: { type: 'string' }, value: { type: 'string' } }, required: ['type', 'elementRef', 'value'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'paste' }, text: { type: 'string' }, format: { enum: ['text', 'md', 'html'] } }, required: ['type', 'text', 'format'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'select-text' }, elementRef: { type: 'string' }, text: { type: 'string' }, prefix: { type: 'string' }, suffix: { type: 'string' }, selectionType: { enum: ['text', 'cursor-before', 'cursor-after'] } }, required: ['type', 'elementRef', 'text'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'drag' }, fromX: { type: 'number' }, fromY: { type: 'number' }, toX: { type: 'number' }, toY: { type: 'number' } }, required: ['type', 'fromX', 'fromY', 'toX', 'toY'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'secondary-action' }, elementRef: { type: 'string' }, action: { type: 'string' } }, required: ['type', 'elementRef', 'action'], additionalProperties: false }
  ]
}

const specs: Array<{
  operation: Operation
  id: string
  modelName: string
  description: string
  inputSchema: ToolDefinition['inputSchema']
  risk: ToolDefinition['risk']
}> = [
  { operation: 'permissions', id: 'computer.permissions', modelName: 'computer_permissions',
    description: 'Check macOS Accessibility, Screen Recording, and event posting permissions for Computer Use.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, risk: 'low' },
  { operation: 'observe', id: 'computer.observe', modelName: 'computer_observe',
    description: 'Inspect the frontmost macOS application and obtain a fresh observation ID and accessible elements.',
    inputSchema: { type: 'object', properties: {
      maxElements: { type: 'integer', minimum: 1, maximum: 500 },
      maxDepth: { type: 'integer', minimum: 1, maximum: 12 }
    }, required: ['maxElements', 'maxDepth'], additionalProperties: false }, risk: 'medium' },
  { operation: 'capture', id: 'computer.capture', modelName: 'computer_capture',
    description: 'Capture the display containing the frontmost window. The image is sent through short lived memory. For coordinate clicks, map image pixels to global points using displayFrame and the returned image width and height.',
    inputSchema: { type: 'object', properties: {
      maxWidth: { type: 'integer', minimum: 1, maximum: 4096 },
      maxHeight: { type: 'integer', minimum: 1, maximum: 4096 }
    }, required: ['maxWidth', 'maxHeight'], additionalProperties: false }, risk: 'medium' },
  { operation: 'act', id: 'computer.act', modelName: 'computer_act',
    description: 'Perform one macOS action using a fresh observation ID. Reobserve after each action. Ask the user before consequential actions.',
    inputSchema: { type: 'object', properties: {
      observationId: { type: 'string', minLength: 1, maxLength: 128 }, action: actionSchema
    }, required: ['observationId', 'action'], additionalProperties: false }, risk: 'high' }
]

export function createComputerUseTools(
  invoke: (input: Input, signal?: AbortSignal) => Promise<unknown>,
  gate?: ComputerUseControlGate
): Registered[] {
  return specs.map(({ operation, id, modelName, description, inputSchema, risk }) => ({
    definition: { id, version: 1, modelName, description, inputSchema, risk,
      sideEffects: { filesystem: 'none', network: false }, timeoutMs: 30_000 },
    executor: {
      async *execute(call: ToolCall, signal?: AbortSignal,
                     context?: { taskId: string }): AsyncIterable<ToolExecutorEvent> {
        if (gate) {
          if (!context?.taskId) throw new Error('COMPUTER_USE_CONTEXT_REQUIRED')
          gate.assertRunning(context.taskId)
        }
        const validated = computerHelperRequest.safeParse({
          version: 1, requestId: 'tool-validation', deadlineUnixMs: 1,
          operation, ...call.arguments
        })
        if (!validated.success || validated.data.operation !== operation) {
          throw new Error('TOOL_INPUT_INVALID: Computer Use arguments are invalid')
        }
        const { version: _version, requestId: _requestId, deadlineUnixMs: _deadline, ...input } = validated.data
        const output = await invoke(input as Input, signal)
        yield { kind: 'result', output: JSON.parse(JSON.stringify(output)) as Extract<ToolExecutorEvent, { kind: 'result' }>['output'] }
      },
      redactForPersistence: (kind: 'input' | 'output', value: Json) => redact(operation, kind, value)
    }
  }))
}
