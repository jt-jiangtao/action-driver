import { presentations } from './presentation.js'
import type { PluginCatalog } from '@actiondriver/plugin-sdk'
import { instructions, skillContent } from './instructions.js'
const { description, computer, output, reset, codeDescription } = instructions
/** Project-level prerequisite the vendored Codex instructions do not carry. */
const skillPrerequisite =
  'Prerequisite: read the `browser-use` Skill before browser actions and the `computer-use` Skill before desktop actions with `tools_local_skills_read`. Each surface checks its own Skill at every RPC. Calls that skip it fail with `SKILL_NOT_LOADED`.'

/** Keeps the model on the host-provided entry. */
const entryPointNote =
  'Entry point: the host provides one persistent global `cua` object. For browsers use `cua.getBrowser({ id: "iab" })`, `cua.getTab(...)` or `cua.createBrowserTab("chrome", url)`; for desktop apps use `cua.getState()` and `cua.getApp("...")`. Browser actions use ActionDriver-owned tabs only. App actions use ActionDriver approval and the local macOS helper.'


export const catalog: PluginCatalog = { tools: [
{
        id: 'tools/local/cua/js',
        presentation: presentations['tools/local/cua/js'],
        version: 1,
        modelName: 'tools_local_cua_js',
        description: [
          description,
          skillPrerequisite,
          entryPointNote,
          computer,
          output
        ].join('\n\n'),
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              minLength: 1,
              maxLength: 200_000,
              description: codeDescription
            },
            timeout_ms: { type: 'integer', minimum: 1_000, maximum: 300_000 },
            title: { type: 'string', maxLength: 200 }
          },
          required: ['code'],
          additionalProperties: false
        },
        risk: 'high',
        sideEffects: { filesystem: 'write', network: true },
        timeoutMs: 320_000
      },
{
        id: 'tools/local/cua/reset',
        presentation: presentations['tools/local/cua/reset'],
        version: 1,
        modelName: 'tools_local_cua_reset',
        description: reset.replaceAll('cua_repl.js', 'tools_local_cua_js'),
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        risk: 'low',
        sideEffects: { filesystem: 'none', network: false },
        timeoutMs: 10_000
      }
], skills: [{ id: 'computer-use', name: 'computer-use', description: 'Control local Mac apps through Computer Use', content: skillContent, resources: ["skills/computer-use/SKILL.md", "skills/computer-use/codex-docs/tinysky-alt-confirmations.md", "skills/computer-use/codex-docs/tinysky-alt-core-cua-repl.md", "skills/computer-use/codex-docs/tinysky-alt-core-node-repl.md", "skills/computer-use/codex-docs/tinysky-alt-other-browser-apis.md"] }] }
export default catalog
