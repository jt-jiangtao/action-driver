// Declarative contracts derived from the public schema inventory. No legacy implementation or schema engine is embedded.
import { z, defineCommand } from './definition.js'
import { selectionRefinement, clipboardRefinement } from './refinements.js'
import { TabsContent, BrowserUserGetTabContext } from './structured.js'
import { WebMcpListTools, WebMcpInvokeTool } from './capability.js'
import { AtlasCommand } from '../command.js'
export const BrowserUserClaimTab = defineCommand(
  'browser_user_claim_tab',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({ id: z.string(), title: z.string().optional(), url: z.string().optional() })
)
export const BrowserUserHistory = defineCommand(
  'browser_user_history',
  z.object({
    browser_id: z.string(),
    queries: z.array(z.string()).min(1).optional(),
    limit: z.number().int().gt(0).optional(),
    from: z.string().optional(),
    to: z.string().optional()
  }),
  z.object({
    items: z.array(
      z.object({ url: z.string(), title: z.string().optional(), dateVisited: z.string() })
    )
  })
)
export const BrowserUserOpenTabs = defineCommand(
  'browser_user_open_tabs',
  z.object({ browser_id: z.string() }),
  z.object({
    tabs: z.array(
      z.object({
        id: z.string(),
        providerTabId: z.string().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
        lastOpened: z.string().optional(),
        tabGroup: z.string().optional()
      })
    )
  })
)
export const CloseTab = defineCommand(
  'close_tab',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({})
)
export const CreateTab = defineCommand(
  'create_tab',
  z.object({ browser_id: z.string() }),
  z.object({ id: z.string() })
)
export const CuaClick = defineCommand(
  'cua_click',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    x: z.number(),
    y: z.number(),
    button: z.number().optional(),
    keys: z.array(z.string()).optional()
  }),
  z.object({})
)
export const CuaDoubleClick = defineCommand(
  'cua_double_click',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    x: z.number(),
    y: z.number(),
    keys: z.array(z.string()).optional()
  }),
  z.object({})
)
export const CuaDownloadMedia = defineCommand(
  'cua_download_media',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    x: z.number(),
    y: z.number(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const CuaDrag = defineCommand(
  'cua_drag',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    path: z.array(z.object({ x: z.number(), y: z.number() })),
    keys: z.array(z.string()).optional()
  }),
  z.object({})
)
export const CuaKeypress = defineCommand(
  'cua_keypress',
  z.object({ browser_id: z.string(), tab_id: z.string(), keys: z.array(z.string()) }),
  z.object({})
)
export const CuaMove = defineCommand(
  'cua_move',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    x: z.number(),
    y: z.number(),
    keys: z.array(z.string()).optional()
  }),
  z.object({})
)
export const CuaScroll = defineCommand(
  'cua_scroll',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    x: z.number(),
    y: z.number(),
    scroll_x: z.number(),
    scroll_y: z.number(),
    keys: z.array(z.string()).optional()
  }),
  z.object({})
)
export const CuaType = defineCommand(
  'cua_type',
  z.object({ browser_id: z.string(), tab_id: z.string(), text: z.string() }),
  z.object({})
)
export const DomCuaClick = {
  ...defineCommand(
    'dom_cua_click',
    z.object({
      browser_id: z.string(),
      tab_id: z.string(),
      node_id: z
        .string({
          required_error: 'node_id is required',
          invalid_type_error: 'node_id must be a string'
        })
        .min(1, 'node_id must not be empty')
    }),
    z.object({})
  ),
  DomNodeIdSchema: z
    .string({
      required_error: 'node_id is required',
      invalid_type_error: 'node_id must be a string'
    })
    .min(1, 'node_id must not be empty')
}
export const DomCuaDoubleClick = defineCommand(
  'dom_cua_double_click',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    node_id: z
      .string({
        required_error: 'node_id is required',
        invalid_type_error: 'node_id must be a string'
      })
      .min(1, 'node_id must not be empty')
  }),
  z.object({})
)
export const DomCuaDownloadMedia = defineCommand(
  'dom_cua_download_media',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    node_id: z
      .string({
        required_error: 'node_id is required',
        invalid_type_error: 'node_id must be a string'
      })
      .min(1, 'node_id must not be empty'),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const DomCuaGetVisibleDom = defineCommand(
  'dom_cua_get_visible_dom',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.unknown()
)
export const DomCuaKeypress = defineCommand(
  'dom_cua_keypress',
  z.object({ browser_id: z.string(), tab_id: z.string(), keys: z.array(z.string()) }),
  z.object({})
)
export const DomCuaScroll = defineCommand(
  'dom_cua_scroll',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    scroll_x: z.number(),
    scroll_y: z.number(),
    node_id: z
      .string({
        required_error: 'node_id is required',
        invalid_type_error: 'node_id must be a string'
      })
      .min(1, 'node_id must not be empty')
      .optional()
  }),
  z.object({})
)
export const DomCuaType = defineCommand(
  'dom_cua_type',
  z.object({ browser_id: z.string(), tab_id: z.string(), text: z.string() }),
  z.object({})
)
export const GetBrowser = defineCommand(
  'get_browser',
  z.object({ id: z.string() }),
  z.object({
    family: z.string().trim().min(1).optional(),
    id: z.string(),
    name: z.string(),
    type: z.enum(['iab', 'extension', 'cdp']),
    profileName: z.string().optional(),
    metadata: z
      .object({ extensionInstanceId: z.string().optional(), codexSessionId: z.string().optional() })
      .optional(),
    apiSupportOverrides: z.record(z.string(), z.boolean()).optional(),
    capabilities: z.object({
      browser: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
      tab: z.array(z.object({ id: z.string(), description: z.string() })).optional()
    })
  })
)
export const GetBrowserDocumentation = defineCommand(
  'get_browser_documentation',
  z.object({ browser_id: z.string() }),
  z.string()
)
export const GetBrowserForUrl = defineCommand(
  'get_browser_for_url',
  z.object({ url: z.string().url() }),
  z.object({
    family: z.string().trim().min(1).optional(),
    id: z.string(),
    name: z.string(),
    type: z.enum(['iab', 'extension', 'cdp']),
    profileName: z.string().optional(),
    metadata: z
      .object({ extensionInstanceId: z.string().optional(), codexSessionId: z.string().optional() })
      .optional(),
    apiSupportOverrides: z.record(z.string(), z.boolean()).optional(),
    capabilities: z.object({
      browser: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
      tab: z.array(z.object({ id: z.string(), description: z.string() })).optional()
    })
  })
)
export const GetDefaultBrowser = defineCommand(
  'get_default_browser',
  z.object({}),
  z.object({
    family: z.string().trim().min(1).optional(),
    id: z.string(),
    name: z.string(),
    type: z.enum(['iab', 'extension', 'cdp']),
    profileName: z.string().optional(),
    metadata: z
      .object({ extensionInstanceId: z.string().optional(), codexSessionId: z.string().optional() })
      .optional(),
    apiSupportOverrides: z.record(z.string(), z.boolean()).optional(),
    capabilities: z.object({
      browser: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
      tab: z.array(z.object({ id: z.string(), description: z.string() })).optional()
    })
  })
)
export const GetDocumentation = defineCommand(
  'get_documentation',
  z.object({ name: z.string() }),
  z.string()
)
export const GetTab = defineCommand(
  'get_tab',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({ id: z.string(), title: z.string().optional(), url: z.string().optional() })
)
export const ListBrowsers = defineCommand(
  'list_browsers',
  z.object({}),
  z.array(
    z.object({
      family: z.string().trim().min(1).optional(),
      id: z.string(),
      name: z.string(),
      type: z.enum(['iab', 'extension', 'cdp']),
      profileName: z.string().optional(),
      metadata: z
        .object({
          extensionInstanceId: z.string().optional(),
          codexSessionId: z.string().optional()
        })
        .optional()
    })
  )
)
export const ListTabs = defineCommand(
  'list_tabs',
  z.object({ browser_id: z.string() }),
  z.object({
    tabs: z.array(
      z.object({
        id: z.string(),
        providerTabId: z.string().optional(),
        url: z.string().optional(),
        title: z.string().optional()
      })
    )
  })
)
export const ManualHandoff = defineCommand(
  'tab_manual_handoff_request',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({})
)
export const MarkTab = {
  ...defineCommand(
    'mark_tab',
    z.object({
      browser_id: z.string(),
      tab_id: z.string(),
      status: z.enum(['handoff', 'deliverable'])
    }),
    z.object({})
  ),
  MarkTabStatusSchema: z.enum(['handoff', 'deliverable'])
}
export const NameSession = defineCommand(
  'name_session',
  z.object({ browser_id: z.string(), name: z.string() }),
  z.object({})
)
export const NavigateTab = defineCommand(
  'navigate_tab_url',
  z.object({ browser_id: z.string(), tab_id: z.string(), url: z.string() }),
  z.object({})
)
export const NavigateTabBack = defineCommand(
  'navigate_tab_back',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({})
)
export const NavigateTabForward = defineCommand(
  'navigate_tab_forward',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({})
)
export const NavigateTabReload = defineCommand(
  'navigate_tab_reload',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({})
)
export const PlaywrightDomSnapshot = defineCommand(
  'playwright_dom_snapshot',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({ dom_snapshot: z.string() })
)
export const PlaywrightDownloadPath = defineCommand(
  'playwright_download_path',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    download_id: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ path: z.string().nullable() })
)
export const PlaywrightElementInfo = defineCommand(
  'playwright_element_info',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    x: z.number(),
    y: z.number(),
    include_non_interactable: z.boolean().optional()
  }),
  z.array(
    z.object({
      nodeId: z.number().int().gt(0).nullable().optional(),
      tagName: z.string(),
      role: z.string().nullable().optional(),
      visibleText: z.string().nullable().optional(),
      ariaName: z.string().nullable().optional(),
      testId: z.string().nullable().optional(),
      boundingBox: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .nullable()
        .optional(),
      preview: z.string(),
      selector: z.object({
        primary: z.string().nullable().optional(),
        candidates: z.array(z.string()),
        frameSelectors: z.array(z.string()).optional()
      })
    })
  )
)
export const PlaywrightElementScreenshot = defineCommand(
  'playwright_element_screenshot',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    x: z.number(),
    y: z.number(),
    include_non_interactable: z.boolean().optional()
  }),
  z.object({ data: z.string() })
)
export const PlaywrightEvaluate = defineCommand(
  'playwright_evaluate',
  z.object({
    browser_id: z.string(),
    selector: z.string().optional(),
    selector_mode: z.literal('all').optional(),
    tab_id: z.string(),
    script: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ value: z.unknown().optional() })
)
export const PlaywrightFileChooserSetFiles = defineCommand(
  'playwright_file_chooser_set_files',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    file_chooser_id: z.string(),
    files: z.array(z.string()),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const PlaywrightLocatorAllTextContents = defineCommand(
  'playwright_locator_all_text_contents',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ values: z.array(z.string()) })
)
export const PlaywrightLocatorClick = defineCommand(
  'playwright_locator_click',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    modifiers: z.array(z.enum(['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'])).optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    force: z.boolean().optional(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const PlaywrightLocatorCount = defineCommand(
  'playwright_locator_count',
  z.object({ browser_id: z.string(), tab_id: z.string(), selector: z.string() }),
  z.object({ count: z.number().int() })
)
export const PlaywrightLocatorDblclick = defineCommand(
  'playwright_locator_dblclick',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    modifiers: z.array(z.enum(['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'])).optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    force: z.boolean().optional(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const PlaywrightLocatorDownloadMedia = defineCommand(
  'playwright_locator_download_media',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ path: z.string() })
)
export const PlaywrightLocatorFill = defineCommand(
  'playwright_locator_fill',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    value: z.string(),
    replace: z.boolean(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const PlaywrightLocatorGetAttribute = defineCommand(
  'playwright_locator_get_attribute',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    name: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ value: z.string().nullable() })
)
export const PlaywrightLocatorInnerText = defineCommand(
  'playwright_locator_inner_text',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ value: z.string() })
)
export const PlaywrightLocatorIsEnabled = defineCommand(
  'playwright_locator_is_enabled',
  z.object({ browser_id: z.string(), tab_id: z.string(), selector: z.string() }),
  z.object({ value: z.boolean() })
)
export const PlaywrightLocatorIsVisible = defineCommand(
  'playwright_locator_is_visible',
  z.object({ browser_id: z.string(), tab_id: z.string(), selector: z.string() }),
  z.object({ value: z.boolean() })
)
export const PlaywrightLocatorPress = defineCommand(
  'playwright_locator_press',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    value: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const PlaywrightLocatorPressSequentially = defineCommand(
  'playwright_locator_press_sequentially',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    value: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const PlaywrightLocatorReadAll = defineCommand(
  'playwright_locator_read_all',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    relative_selector: z.string().optional(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({
    values: z.array(
      z
        .object({
          attributes: z.record(z.string(), z.string()),
          inner_text: z.string(),
          text_content: z.string().nullable()
        })
        .nullable()
    )
  })
)
export const PlaywrightLocatorSelectOption = {
  ...defineCommand(
    'playwright_locator_select_option',
    z.object({
      browser_id: z.string(),
      tab_id: z.string(),
      selector: z.string(),
      selections: z
        .array(
          z
            .object({
              value: z.string().optional(),
              label: z.string().optional(),
              index: z.number().int().min(0).optional()
            })
            .superRefine(selectionRefinement)
        )
        .min(1),
      timeout_ms: z.number().int().gt(0).optional()
    }),
    z.object({})
  ),
  SelectOptionSchema: z
    .object({
      value: z.string().optional(),
      label: z.string().optional(),
      index: z.number().int().min(0).optional()
    })
    .superRefine(selectionRefinement)
}
export const PlaywrightLocatorSetChecked = defineCommand(
  'playwright_locator_set_checked',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    checked: z.boolean(),
    force: z.boolean().optional(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const PlaywrightLocatorTextContent = defineCommand(
  'playwright_locator_text_content',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ value: z.string().nullable() })
)
export const PlaywrightLocatorWaitFor = defineCommand(
  'playwright_locator_wait_for',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    selector: z.string(),
    state: z.enum(['attached', 'detached', 'visible', 'hidden']),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({})
)
export const PlaywrightWaitForDownload = defineCommand(
  'playwright_wait_for_download',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ download_id: z.string() })
)
export const PlaywrightWaitForFileChooser = defineCommand(
  'playwright_wait_for_file_chooser',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ file_chooser_id: z.string(), is_multiple: z.boolean() })
)
export const PlaywrightWaitForLoadState = {
  ...defineCommand(
    'playwright_wait_for_load_state',
    z.object({
      browser_id: z.string(),
      tab_id: z.string(),
      state: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
      timeout_ms: z.number().int().gt(0).optional()
    }),
    z.object({})
  ),
  LoadStateSchema: z.enum(['load', 'domcontentloaded', 'networkidle'])
}
export const PlaywrightWaitForTimeout = defineCommand(
  'playwright_wait_for_timeout',
  z.object({ browser_id: z.string(), tab_id: z.string(), timeout_ms: z.number().int().min(0) }),
  z.object({})
)
export const PlaywrightWaitForURL = defineCommand(
  'playwright_wait_for_url',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    url: z.string(),
    wait_until: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional(),
    timeout_ms: z.number().int().gt(0).optional()
  }),
  z.object({ url: z.string().optional() })
)
export const RuntimeConfig = defineCommand(
  'runtime_config',
  z.object({ browser_id: z.string() }),
  z.object({ display_truncate_max_chars: z.number().int().gt(0).optional() })
)
export const SelectedTab = defineCommand(
  'selected_tab',
  z.object({ browser_id: z.string() }),
  z.object({ id: z.string().optional() })
)
export const TabAxAction = {
  ...defineCommand(
    'tab_ax_action',
    z.object({
      browser_id: z.string(),
      tab_id: z.string(),
      action: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('paste'),
          element_index: z.number().int().min(0).nullable(),
          text: z.string(),
          format: z.enum(['text', 'md', 'html']).optional()
        }),
        z.object({
          kind: z.literal('click'),
          target: z.union([z.number().int().min(0), z.tuple([z.number(), z.number()])]),
          mouse_button: z.enum(['left', 'right', 'middle', 'l', 'r', 'm']).optional(),
          click_count: z.number().int().gt(0).optional()
        }),
        z.object({
          kind: z.literal('drag'),
          from: z.tuple([z.number(), z.number()]),
          to: z.tuple([z.number(), z.number()])
        }),
        z.object({
          kind: z.literal('perform_secondary_action'),
          element_index: z.number().int().min(0),
          action: z.string()
        }),
        z.object({
          kind: z.literal('press_key'),
          element_index: z.number().int().min(0).nullable(),
          key: z.string()
        }),
        z.object({
          kind: z.literal('scroll'),
          target: z.union([z.number().int().min(0), z.tuple([z.number(), z.number()])]),
          direction: z.enum(['up', 'down', 'left', 'right', 'u', 'd', 'l', 'r']),
          pages: z.number().optional()
        }),
        z.object({
          kind: z.literal('select_text'),
          element_index: z.number().int().min(0),
          text: z.string(),
          prefix: z.string().optional(),
          suffix: z.string().optional(),
          selection_type: z.enum(['text', 'cursor_before', 'cursor_after']).optional()
        }),
        z.object({
          kind: z.literal('set_value'),
          element_index: z.number().int().min(0),
          value: z.string()
        }),
        z.object({
          kind: z.literal('type_text'),
          element_index: z.number().int().min(0).nullable(),
          text: z.string()
        })
      ])
    }),
    z.object({})
  ),
  ActionSchema: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('paste'),
      element_index: z.number().int().min(0).nullable(),
      text: z.string(),
      format: z.enum(['text', 'md', 'html']).optional()
    }),
    z.object({
      kind: z.literal('click'),
      target: z.union([z.number().int().min(0), z.tuple([z.number(), z.number()])]),
      mouse_button: z.enum(['left', 'right', 'middle', 'l', 'r', 'm']).optional(),
      click_count: z.number().int().gt(0).optional()
    }),
    z.object({
      kind: z.literal('drag'),
      from: z.tuple([z.number(), z.number()]),
      to: z.tuple([z.number(), z.number()])
    }),
    z.object({
      kind: z.literal('perform_secondary_action'),
      element_index: z.number().int().min(0),
      action: z.string()
    }),
    z.object({
      kind: z.literal('press_key'),
      element_index: z.number().int().min(0).nullable(),
      key: z.string()
    }),
    z.object({
      kind: z.literal('scroll'),
      target: z.union([z.number().int().min(0), z.tuple([z.number(), z.number()])]),
      direction: z.enum(['up', 'down', 'left', 'right', 'u', 'd', 'l', 'r']),
      pages: z.number().optional()
    }),
    z.object({
      kind: z.literal('select_text'),
      element_index: z.number().int().min(0),
      text: z.string(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
      selection_type: z.enum(['text', 'cursor_before', 'cursor_after']).optional()
    }),
    z.object({
      kind: z.literal('set_value'),
      element_index: z.number().int().min(0),
      value: z.string()
    }),
    z.object({
      kind: z.literal('type_text'),
      element_index: z.number().int().min(0).nullable(),
      text: z.string()
    })
  ])
}
export const TabAxGetState = defineCommand(
  'tab_ax_get_state',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    content: z.enum(['axState', 'screenshot', 'axStateAndScreenshot']),
    disable_diffing: z.boolean().optional()
  }),
  z.object({
    state: z.string().optional(),
    data: z.string().optional(),
    screenshot_unavailable: z.string().optional()
  })
)
export const TabClipboardRead = defineCommand(
  'tab_clipboard_read',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({
    items: z.array(
      z.object({
        entries: z.array(
          z
            .object({
              mime_type: z.string(),
              text: z.string().optional(),
              base64: z.string().optional()
            })
            .superRefine(clipboardRefinement)
        ),
        presentation_style: z.enum(['unspecified', 'inline', 'attachment']).optional()
      })
    )
  })
)
export const TabClipboardReadText = defineCommand(
  'tab_clipboard_read_text',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({ text: z.string() })
)
export const TabClipboardWrite = defineCommand(
  'tab_clipboard_write',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    items: z.array(
      z.object({
        entries: z.array(
          z
            .object({
              mime_type: z.string(),
              text: z.string().optional(),
              base64: z.string().optional()
            })
            .superRefine(clipboardRefinement)
        ),
        presentation_style: z.enum(['unspecified', 'inline', 'attachment']).optional()
      })
    )
  }),
  z.object({})
)
export const TabClipboardWriteText = defineCommand(
  'tab_clipboard_write_text',
  z.object({ browser_id: z.string(), tab_id: z.string(), text: z.string() }),
  z.object({})
)
export const TabContentExport = defineCommand(
  'tab_content_export',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({ path: z.string() })
)
export const TabContentExportGSuite = {
  ...defineCommand(
    'tab_content_export_gsuite',
    z.object({
      browser_id: z.string(),
      tab_id: z.string(),
      format: z.enum(['pdf', 'md', 'xlsx', 'csv', 'docx', 'pptx'])
    }),
    z.object({ path: z.string() })
  ),
  GSuiteExportTypeSchema: z.enum(['pdf', 'md', 'xlsx', 'csv', 'docx', 'pptx'])
}
export const TabContentExportYouTubeTranscript = defineCommand(
  'tab_content_export_youtube_transcript',
  z.object({ browser_id: z.string(), tab_id: z.string() }),
  z.object({ path: z.string() })
)
export const TabDevLogs = {
  ...defineCommand(
    'tab_dev_logs',
    z.object({
      browser_id: z.string(),
      tab_id: z.string(),
      filter: z.string().optional(),
      levels: z.array(z.enum(['debug', 'info', 'log', 'warn', 'error'])).optional(),
      limit: z.number().int().gt(0).optional()
    }),
    z.object({
      logs: z.array(
        z.object({
          level: z.enum(['debug', 'info', 'log', 'warn', 'error']),
          message: z.string(),
          timestamp: z.string(),
          url: z.string().optional()
        })
      )
    })
  ),
  LogLevelSchema: z.enum(['debug', 'info', 'log', 'warn', 'error'])
}
export const TabGetJsDialog = {
  ...defineCommand(
    'tab_get_js_dialog',
    z.object({ browser_id: z.string(), tab_id: z.string() }),
    z.object({
      dialog: z
        .object({ id: z.string(), type: z.enum(['alert', 'beforeunload', 'confirm', 'prompt']) })
        .nullable()
    })
  ),
  JsDialogTypeSchema: z.enum(['alert', 'beforeunload', 'confirm', 'prompt']),
  ResultDialogSchema: z.object({
    id: z.string(),
    type: z.enum(['alert', 'beforeunload', 'confirm', 'prompt'])
  })
}
export const TabHandleJsDialog = defineCommand(
  'tab_handle_js_dialog',
  z.object({
    action: z.enum(['accept', 'dismiss']),
    browser_id: z.string(),
    dialog_id: z.string(),
    prompt_text: z.string().optional(),
    tab_id: z.string()
  }),
  z.object({})
)
export const TabScreenshot = defineCommand(
  'tab_screenshot',
  z.object({
    browser_id: z.string(),
    tab_id: z.string(),
    fullPage: z.boolean().optional(),
    cropX: z.number().optional(),
    cropY: z.number().optional(),
    cropWidth: z.number().optional(),
    cropHeight: z.number().optional()
  }),
  z.object({ data: z.string() })
)
export const Commands = {
  AtlasCommand,
  BrowserUserClaimTab,
  BrowserUserGetTabContext,
  BrowserUserHistory,
  BrowserUserOpenTabs,
  CloseTab,
  CreateTab,
  CuaClick,
  CuaDoubleClick,
  CuaDownloadMedia,
  CuaDrag,
  CuaKeypress,
  CuaMove,
  CuaScroll,
  CuaType,
  DomCuaClick,
  DomCuaDoubleClick,
  DomCuaDownloadMedia,
  DomCuaGetVisibleDom,
  DomCuaKeypress,
  DomCuaScroll,
  DomCuaType,
  GetBrowser,
  GetBrowserDocumentation,
  GetBrowserForUrl,
  GetDefaultBrowser,
  GetDocumentation,
  GetTab,
  ListBrowsers,
  ListTabs,
  ManualHandoff,
  MarkTab,
  NameSession,
  NavigateTab,
  NavigateTabBack,
  NavigateTabForward,
  NavigateTabReload,
  PlaywrightDomSnapshot,
  PlaywrightDownloadPath,
  PlaywrightElementInfo,
  PlaywrightElementScreenshot,
  PlaywrightEvaluate,
  PlaywrightFileChooserSetFiles,
  PlaywrightLocatorAllTextContents,
  PlaywrightLocatorClick,
  PlaywrightLocatorCount,
  PlaywrightLocatorDblclick,
  PlaywrightLocatorDownloadMedia,
  PlaywrightLocatorFill,
  PlaywrightLocatorGetAttribute,
  PlaywrightLocatorInnerText,
  PlaywrightLocatorIsEnabled,
  PlaywrightLocatorIsVisible,
  PlaywrightLocatorPress,
  PlaywrightLocatorPressSequentially,
  PlaywrightLocatorReadAll,
  PlaywrightLocatorSelectOption,
  PlaywrightLocatorSetChecked,
  PlaywrightLocatorTextContent,
  PlaywrightLocatorWaitFor,
  PlaywrightWaitForDownload,
  PlaywrightWaitForFileChooser,
  PlaywrightWaitForLoadState,
  PlaywrightWaitForTimeout,
  PlaywrightWaitForURL,
  RuntimeConfig,
  SelectedTab,
  TabAxAction,
  TabAxGetState,
  TabClipboardRead,
  TabClipboardReadText,
  TabClipboardWrite,
  TabClipboardWriteText,
  TabContentExport,
  TabContentExportGSuite,
  TabContentExportYouTubeTranscript,
  TabDevLogs,
  TabGetJsDialog,
  TabHandleJsDialog,
  TabScreenshot,
  TabsContent,
  WebMcpInvokeTool,
  WebMcpListTools
}
