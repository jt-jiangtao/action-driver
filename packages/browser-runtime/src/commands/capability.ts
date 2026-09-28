import { z, defineCommand } from './definition.js'
const scope = { browser_id: z.string(), tab_id: z.string() }
const safeId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,48}$/)
  .refine((value) => !new Set(['__proto__', 'constructor', 'prototype']).has(value))
const authField = z.object({
  id: safeId,
  label: z.string(),
  type: z.string().min(1),
  autocomplete: z.string().nullable().optional(),
  required: z.boolean(),
  selector: z.string()
})
const authOption = z
  .object({
    id: safeId,
    label: z.string().trim().min(1).max(120),
    selector: z.string().optional(),
    field_ids: z.array(z.string()).max(6).optional()
  })
  .refine(
    (value) => (value.selector != null) !== (value.field_ids?.length ?? 0) > 0,
    'browser auth options require either a selector or credential fields'
  )
const authRequest = z
  .object({
    origin: z.string(),
    fields: z.array(authField).max(6),
    options: z.array(authOption).min(2).max(10).optional(),
    qr_code: z.literal(true).optional(),
    submit: z.object({ selector: z.string(), action: z.enum(['click', 'press_enter']) }).optional()
  })
  .refine(
    (value) => value.fields.length > 0 || value.options != null || value.qr_code === true,
    'browser auth requests require credential fields, sign-in options, or a QR code'
  )
export const TabBrowserAuthCommands = {
  Handoff: defineCommand(
    'tab_browser_auth_handoff',
    authRequest.and(z.object(scope)),
    z.object({
      status: z.enum([
        'submitted',
        'declined',
        'cancelled',
        'unavailable',
        'expired',
        'origin_changed',
        'page_changed',
        'locator_invalid',
        'submission_failed'
      ]),
      locator_error: z
        .object({ field_id: z.string(), reason: z.literal('not_user_visible') })
        .optional(),
      selected_option: z.string().optional(),
      reason: z.literal('user_took_over').optional()
    })
  )
}
const assetKinds = z.enum(['font', 'image', 'script', 'stylesheet', 'video', 'other'])
const bundleKinds = z.enum(['font', 'image', 'stylesheet', 'video'])
const assetSource = z.object({
  kind: z.enum(['attribute', 'computedStyle', 'resource']),
  nodeId: z.number().int().positive().optional(),
  property: z.string().optional()
})
const inventory = z.object({
  assets: z.array(
    z.object({
      id: z.string(),
      kind: assetKinds,
      name: z.string(),
      sources: z.array(assetSource),
      url: z.string()
    })
  ),
  id: z.string(),
  inlineSvgs: z.array(z.object({ id: z.string(), markup: z.string(), name: z.string() })),
  pageUrl: z.string().nullable(),
  summary: z.object({
    byKind: z.record(assetKinds, z.number().int().nonnegative()),
    inlineSvgCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative()
  })
})
const bundledAsset = z.object({
  contentType: z.string().nullable(),
  id: z.string(),
  kind: bundleKinds,
  name: z.string(),
  path: z.string(),
  url: z.string()
})
const bundleFailure = z.object({
  contentType: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  reason: z.string(),
  url: z.string()
})
export const TabPageAssetsCommands = {
  Bundle: defineCommand(
    'tab_page_assets_bundle',
    z.object({
      assetIds: z.array(z.string()).optional(),
      inventoryId: z.string(),
      kinds: z.array(bundleKinds).optional(),
      ...scope
    }),
    z.object({
      assets: z.array(bundledAsset),
      directoryPath: z.string(),
      failures: z.array(bundleFailure),
      manifestPath: z.string(),
      summary: z.object({
        downloadedCount: z.number().int().nonnegative(),
        elapsedMs: z.number().nonnegative(),
        failedCount: z.number().int().nonnegative(),
        requestedCount: z.number().int().nonnegative()
      })
    })
  ),
  List: defineCommand('tab_page_assets_list', z.object(scope), inventory)
}
const annotations = z.object({
  readOnlyHint: z.boolean().optional(),
  untrustedContentHint: z.boolean().optional(),
  consequentialHint: z.boolean().optional()
})
export const WebMcpListTools = defineCommand(
  'webmcp_list_tools',
  z.object(scope),
  z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        call_name: z.string(),
        registration_id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        input_schema: z.unknown(),
        annotations: annotations.optional(),
        origin: z.string().optional(),
        pageUrl: z.string().optional()
      })
    )
  })
)
export const WebMcpInvokeTool = defineCommand(
  'webmcp_invoke_tool',
  z.object({
    ...scope,
    tool_name: z.string(),
    tool_description: z.string().optional(),
    tool_origin: z.string().optional(),
    tool_title: z.string().optional(),
    registration_id: z.string(),
    input: z.unknown(),
    timeout_ms: z.number().int().positive().optional()
  }),
  z.object({ result: z.unknown() })
)
