import type { Contribution, InvocationContext, Json, PluginOwner, SkillContribution } from '@actiondriver/plugin-contracts'
import type { ToolDefinition, ToolExecutor } from '@actiondriver/plugin-contracts'
export type { Contribution, InvocationContext, Json, PluginOwner } from '@actiondriver/plugin-contracts'
export interface Disposable { dispose(): void | Promise<void> }
export interface DisposableStore { add<T extends Disposable>(resource: T): T }
export type StopReason = 'disabled' | 'upgrade' | 'uninstall' | 'shutdown' | 'crash'
export interface HostTransport {
  request(method: string, payload: Json, context?: InvocationContext, signal?: AbortSignal): Promise<Json>
  stream?(method: string, payload: Json, context: InvocationContext, signal: AbortSignal): AsyncIterable<Json>
  subscribe?(resourceId: string, handler: (event: Json) => Promise<void>): Disposable
}
export interface RegistrationPort {
  register(contribution: Contribution, handler?: (input: Json, context: InvocationContext, signal: AbortSignal) => Promise<Json>): Disposable
}
export interface ToolRegistrationPort { register(definition: ToolDefinition, executor: ToolExecutor): Disposable }
export type ContributionHandler = (input: Json, context: InvocationContext, signal: AbortSignal) => Promise<Json>
export interface ResourceHandle { resourceId: string }
export interface ActionDriverAPI {
  tools: ToolRegistrationPort
  contributions: RegistrationPort
  commands: { register(id: string, handler: ContributionHandler): Disposable; execute(id: string, input: Json, context: InvocationContext, signal: AbortSignal): Promise<Json> }
  skills: { register(skill: SkillContribution): Disposable }
  services: { start(id: string): Promise<ResourceHandle>; stop(handle: ResourceHandle): Promise<void> }
  panels: { register(id: string, handler?: ContributionHandler): Disposable; open(id: string): Promise<ResourceHandle>; close(handle: ResourceHandle): Promise<void> }
  sessions: { getContext(context: InvocationContext): Promise<Json> }
  artifacts: { create(input: Json, context: InvocationContext): Promise<Json>; read(id: string, context: InvocationContext): Promise<Json> }
  credentials: { request(input: { id: string; purpose: string }, context: InvocationContext): Promise<Json> }
  events: { subscribe(type: string, handler: (event: Json) => Promise<void>): Promise<Disposable> }
  capabilities: { stream(id: string, input: Json, context: InvocationContext, signal: AbortSignal): AsyncIterableIterator<Json>; register(id: string, handler: ContributionHandler): Disposable; invoke(id: string, input: Json, context: InvocationContext, signal: AbortSignal): Promise<Json> }
  storage: { get(key: string): Promise<Json>; set(key: string, value: Json): Promise<void> }
  logging: { write(level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: Record<string, Json>): Promise<void> }
}
export interface PluginContext { readonly plugin: PluginOwner; readonly subscriptions: DisposableStore; readonly api: ActionDriverAPI }
export interface PluginModule { activate(context: PluginContext): void | Promise<void>; deactivate?(reason: StopReason): void | Promise<void> }

export type { PluginCatalog, SkillContribution, PanelDefinition } from '@actiondriver/plugin-contracts'
export type { ToolDefinition, ToolExecutor, ToolCall, ToolExecutorEvent, ImageAssetRef } from '@actiondriver/plugin-contracts'

export { createPluginContext, ResourceLedger } from './context.js'

export { EventQueue } from './event-queue.js'

export { PluginError } from '@actiondriver/plugin-contracts'

export { MAX_IMAGE_BYTES } from '@actiondriver/plugin-contracts'

export { createToolIdentity, toolIdSchema, type ToolTarget } from '@actiondriver/plugin-contracts'

export { toolPresentationSchema, toolDetailsSchema, projectToolDetails, type ToolPresentation, type ToolPresentationField, type ToolDetails, type ToolDetailField } from '@actiondriver/plugin-contracts'
