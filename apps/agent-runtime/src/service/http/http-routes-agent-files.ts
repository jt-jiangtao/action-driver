import type { Hono } from 'hono'
import { z } from 'zod'
import { enabledSchema, id, invalid, success, validate } from './http-contract'
import type { AgentFileStore } from '../../agent-files/agent-file-store'
import type { SkillInstaller } from '../../agent-files/skill-installer'

export type AgentFileRoutes = {
  agentFiles: AgentFileStore
  skillInstaller?: SkillInstaller
}

const saveAgentFileSchema = z
  .object({ path: id, content: z.string(), expectedDigest: id })
  .strict()

const createAgentSkillSchema = z.object({ name: id, description: z.string() }).strict()

const installSkillSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('local'), path: id }).strict(),
  z.object({ source: z.literal('github'), url: z.url() }).strict()
])

const renameAgentSkillSchema = z.object({ name: id }).strict()

const resetPromptSchema = z.object({ expectedDigest: id }).strict()

export function registerAgentFileRoutes(app: Hono, options: AgentFileRoutes): void {
  const files = options.agentFiles
  const skillInstaller = options.skillInstaller
  app.get('/agent-files/main-prompt', async (context) =>
    context.json(success(await files.getMainPrompt()))
  )
  app.post('/agent-files/main-prompt/reset', validate(resetPromptSchema), async (context) =>
    context.json(success(await files.resetMainPrompt(context.req.valid('json').expectedDigest)))
  )
  app.get('/agent-files/skills', async (context) =>
    context.json(success(await files.listSkills()))
  )
  if (skillInstaller) {
    app.post('/agent-files/skills/install', validate(installSkillSchema), async (context) =>
      context.json(success(await skillInstaller.installSkill(context.req.valid('json'))))
    )
  }
  app.get('/agent-files/skills/:skillId/tree', async (context) =>
    context.json(success(await files.getSkillTree(context.req.param('skillId'))))
  )
  app.post('/agent-files/skills', validate(createAgentSkillSchema), async (context) =>
    context.json(success(await files.createSkill(context.req.valid('json'))))
  )
  app.post('/agent-files/skills/:skillId/rename', validate(renameAgentSkillSchema), async (context) =>
    context.json(
      success(await files.renameSkill(context.req.param('skillId'), context.req.valid('json').name))
    )
  )
  app.delete('/agent-files/skills/:skillId', async (context) => {
    await files.deleteSkill(context.req.param('skillId'))
    return context.json(success(null))
  })
  app.post('/agent-files/skills/:skillId/enabled', validate(enabledSchema), async (context) =>
    context.json(
      success(
        await files.setSkillEnabled(
          context.req.param('skillId'),
          context.req.valid('json').enabled
        )
      )
    )
  )
  app.get('/agent-files/file', async (context) => {
    const path = context.req.query('path')
    if (!path) return context.json(invalid(), 400)
    return context.json(success(await files.readFile(path)))
  })
  app.post('/agent-files/file', validate(saveAgentFileSchema), async (context) =>
    context.json(success(await files.saveFile(context.req.valid('json'))))
  )
}
