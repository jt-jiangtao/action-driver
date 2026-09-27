import { presentations } from './presentation.js'
import type { PluginCatalog } from '@actiondriver/plugin-sdk'
import { instructions, skillContent } from './instructions.js'
const { description, disabledBrowser, computer, output, reset, codeDescription } = instructions
/** Project-level prerequisite the vendored Codex instructions do not carry. */
const skillPrerequisite =
  'Prerequisite: before the first `tools.local.computer-use.js` call in a conversation, read the `computer-use` Skill with `tools.local.skills.read` (`skillId: "computer-use"`). Calls that skip it fail with `SKILL_NOT_LOADED`.'

/** Keeps the model on the host-provided entry instead of importing the vendored package itself. */
const entryPointNote =
  'Entry point: the host provides the global `cua` object — call `cua.getState()`, `cua.getApp("...")` and the application methods. Do not `import("@oai/sky")` and do not reference a `sky` global; the vendored package is only loadable through the host.'


export const catalog: PluginCatalog = { tools: [
{
        id: 'tools.local.computer-use.js',
        presentation: presentations['tools.local.computer-use.js'],
        version: 1,
        modelName: 'tools.local.computer-use.js',
        description: [
          description,
          skillPrerequisite,
          entryPointNote,
          disabledBrowser,
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
        id: 'tools.local.computer-use.reset',
        presentation: presentations['tools.local.computer-use.reset'],
        version: 1,
        modelName: 'tools.local.computer-use.reset',
        description: reset.replaceAll('cua_repl.js', 'tools.local.computer-use.js'),
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        risk: 'low',
        sideEffects: { filesystem: 'none', network: false },
        timeoutMs: 10_000
      }
], skills: [{ id: 'computer-use', name: 'computer-use', description: 'Control local Mac apps through Computer Use', content: skillContent, resources: ["skills/computer-use/SKILL.md", "skills/computer-use/codex-docs/tinysky-alt-confirmations.md", "skills/computer-use/codex-docs/tinysky-alt-core-cua-repl.md", "skills/computer-use/codex-docs/tinysky-alt-core-node-repl.md", "skills/computer-use/codex-docs/tinysky-alt-other-browser-apis.md"] }] }
export default catalog
