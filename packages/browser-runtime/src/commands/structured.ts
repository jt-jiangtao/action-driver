import { z, defineCommand } from './definition.js'
const scope = { browser_id: z.string(), tab_id: z.string() }
const cdpTarget = z
  .object({ session_id: z.string().min(1).optional(), target_id: z.string().min(1).optional() })
  .refine(
    (value) => (value.session_id == null) !== (value.target_id == null),
    'CDP target must provide exactly one of session_id or target_id.'
  )
const cdpSource = z.object({
  extensionId: z.string().optional(),
  sessionId: z.string().optional(),
  tabId: z.number().int().optional(),
  targetId: z.string().optional()
})
const cdpEvent = z.object({
  sequence: z.number().int().positive(),
  source: cdpSource,
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional()
})
export const TabCdpCommands = {
  Call: defineCommand(
    'tab_cdp_call',
    z.object({
      ...scope,
      method: z.string().min(1),
      params: z.record(z.string(), z.unknown()).optional(),
      target: cdpTarget.optional(),
      timeout_ms: z.number().int().positive().optional()
    }),
    z.unknown()
  ),
  Events: defineCommand(
    'tab_cdp_events',
    z.object({
      after_sequence: z.number().int().nonnegative().optional(),
      browser_id: scope.browser_id,
      limit: z.number().int().positive().max(1000).optional(),
      methods: z.array(z.string().min(1)).min(1).optional(),
      tab_id: scope.tab_id,
      target: cdpTarget.optional(),
      timeout_ms: z.number().int().nonnegative().optional()
    }),
    z.object({
      cursor: z.number().int().nonnegative(),
      events: z.array(cdpEvent),
      hasMore: z.boolean(),
      truncated: z.boolean()
    })
  )
}
export const TabBotDetectionCommands = {
  Report: defineCommand(
    'tab_bot_detection_report',
    z.object({
      reason: z.enum(['captcha_failed', 'access_denied', 'challenge_loop', 'unexpected_bot_error']),
      ...scope
    }),
    z.object({ status: z.literal('reported'), hostname: z.string().nullable() })
  )
}
const ContentTypeSchema = z.enum(['html', 'text', 'domSnapshot'])
export const TabsContent = {
  ...defineCommand(
    'tabs_content',
    z.object({
      browser_id: z.string(),
      urls: z.array(z.string()),
      content_type: ContentTypeSchema,
      timeout_ms: z.number().int().positive().optional()
    }),
    z.object({
      results: z.array(
        z.object({ url: z.string(), title: z.string().nullable(), content: z.string().nullable() })
      )
    })
  ),
  ContentTypeSchema
}
export const BrowserUserGetTabContext = defineCommand(
  'browser_user_get_tab_context',
  z.object({ browser_id: z.string(), expected_url: z.string().optional(), tab_id: z.string() }),
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('library_file'),
      libraryFileId: z.string().min(1),
      fileId: z.string().min(1),
      fileName: z.string(),
      mimeType: z.string(),
      title: z.string(),
      url: z.string()
    }),
    z.object({
      kind: z.literal('text'),
      text: z.string(),
      title: z.string(),
      truncated: z.boolean(),
      url: z.string()
    }),
    z.object({
      dataBase64: z.string(),
      fileName: z.string(),
      kind: z.literal('document'),
      mimeType: z.string(),
      title: z.string(),
      url: z.string()
    })
  ])
)
