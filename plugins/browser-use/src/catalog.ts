import type { PluginCatalog } from '@actiondriver/plugin-sdk'

/** Browser Use contributes instructions; the model calls the shared CUA JS entry. */
export const catalog: PluginCatalog = {
  tools: [],
  skills: [{
    id: 'browser-use', name: 'browser-use',
    description: 'Operate the current task’s embedded browser or an isolated Chrome window',
    content: 'Use tools_local_cua_js with the persistent global cua. Start with await cua.getBrowser({ id: "iab" }) for the right-hand browser, await cua.createBrowserTab("iab", url) to open a page there, or await cua.createBrowserTab("chrome", url) for a new isolated Chrome profile. Use cua.getTab(id, { browser: "iab" }) for an existing managed tab. Inspect the returned accessibility state before using tab.cua actions. Each Agent operates only its own task-owned tabs; Chrome never connects to an existing browser window. Read this Skill before Browser Use; Computer Use has a separate Skill and app approval.',
    resources: []
  }]
}
export default catalog
