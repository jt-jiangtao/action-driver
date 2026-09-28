import { z, defineCommand } from './definition.js'
const browser = z.object({ browser_id: z.string() })
const call = defineCommand(
  'browser_management_call',
  z.object({
    args: z.array(z.unknown()),
    browser_id: z.string(),
    method: z.string(),
    namespace: z.string()
  }),
  z.object({ value: z.unknown() })
)
const before = z
  .object({
    bookmarks: z.array(
      z.object({
        id: z.string(),
        index: z.number().optional(),
        parentId: z.string().optional(),
        title: z.string(),
        url: z.string().optional()
      })
    ),
    tabLayout: z.object({
      groups: z.array(
        z.object({
          collapsed: z.boolean(),
          color: z.string(),
          id: z.number(),
          title: z.string().optional(),
          windowId: z.number()
        })
      ),
      tabs: z.array(
        z.object({
          autoDiscardable: z.boolean(),
          groupId: z.number(),
          id: z.number(),
          index: z.number(),
          pinned: z.boolean(),
          url: z.string().optional(),
          windowId: z.number()
        })
      )
    }),
    windows: z.array(
      z.object({
        focused: z.boolean(),
        height: z.number().optional(),
        id: z.number(),
        left: z.number().optional(),
        state: z.string().optional(),
        top: z.number().optional(),
        width: z.number().optional()
      })
    )
  })
  .partial()
const AuditChangeSchema = call.PayloadSchema.omit({ browser_id: true }).extend({
  before,
  createdAt: z.number(),
  result: z.union([z.number(), z.object({ id: z.string() })]).optional()
})
const audit = {
  ...defineCommand(
    'browser_management_get_audit_trail',
    call.PayloadSchema.pick({ browser_id: true }),
    z.object({ changes: z.array(AuditChangeSchema) })
  ),
  AuditChangeSchema
}
function commandMap(items: Array<{ commandType: string }>) {
  return Object.fromEntries(items.map((item) => [item.commandType, item]))
}
export const BrowserManagementCommands = {
  Call: call,
  GetAuditTrail: audit,
  commands: commandMap([call, audit])
}
const get = defineCommand('browser_visibility_get', browser, z.object({ visible: z.boolean() }))
const set = defineCommand(
  'browser_visibility_set',
  z.object({ browser_id: z.string(), visible: z.boolean() }),
  z.object({})
)
export const BrowserVisibilityCommands = { Get: get, Set: set, commands: commandMap([get, set]) }
const reset = defineCommand('browser_viewport_reset', browser, z.object({}))
const viewport = defineCommand(
  'browser_viewport_set',
  z.object({
    browser_id: z.string(),
    height: z.number().int().positive(),
    width: z.number().int().positive()
  }),
  z.object({})
)
export const BrowserViewportCommands = {
  Reset: reset,
  Set: viewport,
  commands: commandMap([reset, viewport])
}
