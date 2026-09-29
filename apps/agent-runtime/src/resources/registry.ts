import {
  ResourceError,
  assertScopeAuthorized,
  parseResourceUri,
  resourceProviderDescriptorSchema,
  type ResourceEntry,
  type ResourceOperationContext,
  type ResourceProvider,
  type ResourceProviderDescriptor,
  type ResourceReadResult,
  type ResourceReference,
  type ResourceScope,
  type ResourceWatchEvent,
  type ResourceWriteRequest
} from '@actiondriver/runtime-contracts'

export interface ResourceProviderRegistryOptions {
  /** Provider protocol versions this host understands. */
  supportedVersions: readonly number[]
  now(): number
}

type Registered = { descriptor: ResourceProviderDescriptor; provider: ResourceProvider }

/**
 * The only entry point for resource operations. It validates the URI, authorizes the caller's
 * scope and deadlines, then dispatches to the single provider that owns the scheme. There is no
 * fallback: an unavailable provider fails instead of reading a same-named local file.
 */
export class ResourceProviderRegistry {
  private readonly providers = new Map<string, Registered>()
  /** Schemes this host has served, so a stopped provider is distinguishable from an unknown one. */
  private readonly known = new Set<string>()
  constructor(private readonly options: ResourceProviderRegistryOptions) {}

  register(descriptorInput: unknown, provider: ResourceProvider): ResourceProviderDescriptor {
    const descriptor = resourceProviderDescriptorSchema.parse(descriptorInput)
    if (!this.options.supportedVersions.includes(descriptor.version)) throw new ResourceError('RESOURCE_UNSUPPORTED', `provider protocol version ${descriptor.version} is not supported`)
    for (const operation of ['read', 'write', 'list', 'watch'] as const) {
      if (descriptor.capabilities[operation] && typeof provider[operation] !== 'function') throw new ResourceError('RESOURCE_UNSUPPORTED', `${descriptor.scheme} declares ${operation} without implementing it`)
    }
    const existing = this.providers.get(descriptor.scheme)
    if (existing) throw new ResourceError('RESOURCE_VERSION_CONFLICT', `${descriptor.scheme}: ${describe(existing.descriptor)} conflicts with ${describe(descriptor)}`)
    this.providers.set(descriptor.scheme, { descriptor, provider })
    this.known.add(descriptor.scheme)
    return descriptor
  }

  unregister(scheme: string): void {
    this.providers.delete(scheme)
  }

  descriptors(): ResourceProviderDescriptor[] {
    return [...this.providers.values()].map(value => structuredClone(value.descriptor))
  }

  resolve(uri: string, request: { authority: ResourceScope }): { reference: ResourceReference; descriptor: ResourceProviderDescriptor; provider: ResourceProvider } {
    const reference = parseResourceUri(uri)
    const registered = this.providers.get(reference.scheme)
    if (!registered) {
      if (this.known.has(reference.scheme)) throw new ResourceError('RESOURCE_UNAVAILABLE', `${reference.scheme} provider is no longer registered`)
      throw new ResourceError('RESOURCE_SCHEME_UNKNOWN', `${reference.scheme} is not served by this host`)
    }
    assertScopeAuthorized(reference, request.authority)
    return { reference, descriptor: registered.descriptor, provider: registered.provider }
  }

  async read(uri: string, context: ResourceOperationContext): Promise<ResourceReadResult> {
    const { provider, reference } = this.resolveAuthorized(uri, context, 'read')
    return dispatch(provider.read, provider, uri, { ...context, authority: { ...context.authority, ...reference.scope } })
  }

  async list(uri: string, context: ResourceOperationContext): Promise<ResourceEntry[]> {
    const { provider, reference } = this.resolveAuthorized(uri, context, 'list')
    return dispatch(provider.list, provider, uri, { ...context, authority: { ...context.authority, ...reference.scope } })
  }

  async write(uri: string, request: ResourceWriteRequest, context: ResourceOperationContext): Promise<ResourceEntry> {
    const { provider, reference } = this.resolveAuthorized(uri, context, 'write')
    return dispatch(provider.write, provider, uri, request, { ...context, authority: { ...context.authority, ...reference.scope } })
  }

  async watch(uri: string, context: ResourceOperationContext): Promise<AsyncIterable<ResourceWatchEvent>> {
    const { provider, reference } = this.resolveAuthorized(uri, context, 'watch')
    return dispatch(provider.watch, provider, uri, { ...context, authority: { ...context.authority, ...reference.scope } })
  }

  private resolveAuthorized(uri: string, context: ResourceOperationContext, operation: 'read' | 'write' | 'list' | 'watch'): { descriptor: ResourceProviderDescriptor; provider: ResourceProvider; reference: ResourceReference } {
    const resolved = this.resolve(uri, { authority: context.authority })
    if (!resolved.descriptor.capabilities[operation]) throw new ResourceError('RESOURCE_UNSUPPORTED', `${resolved.descriptor.scheme} does not support ${operation}`)
    if (context.signal.aborted) throw new ResourceError('RESOURCE_CANCELLED', `${uri}: cancelled before dispatch`)
    if (context.deadline <= this.options.now()) throw new ResourceError('RESOURCE_DEADLINE_EXCEEDED', `${uri}: deadline exceeded before dispatch`)
    return resolved
  }
}

function describe(descriptor: ResourceProviderDescriptor): string {
  return `${descriptor.owner?.pluginId ?? 'host'}@${descriptor.owner?.version ?? descriptor.version}`
}

function dispatch<A extends unknown[], R>(operation: ((...args: A) => R) | undefined, provider: ResourceProvider, ...args: A): R {
  if (typeof operation !== 'function') throw new ResourceError('RESOURCE_UNSUPPORTED', 'the provider does not implement this operation')
  return operation.apply(provider, args)
}
