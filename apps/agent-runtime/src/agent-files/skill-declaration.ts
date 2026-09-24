import { z } from 'zod'
import { parseDocument } from 'yaml'

const metadataSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  executor: z.unknown().optional()
}).passthrough()

export type SkillDeclaration = {
  name: string
  description: string
  body: string
  executorId: string | null
}

export function parseSkillDeclaration(markdown: string): SkillDeclaration {
  let body = markdown
  let metadata: z.infer<typeof metadataSchema> = {}
  if (markdown.startsWith('---\n') || markdown.startsWith('---\r\n')) {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!match) throw new Error('SKILL_DECLARATION_INVALID: frontmatter is not closed')
    const document = parseDocument(match[1]!, { uniqueKeys: true })
    if (document.errors.length) throw new Error(`SKILL_DECLARATION_INVALID: ${document.errors[0]!.message}`)
    metadata = metadataSchema.parse(document.toJS())
    body = markdown.slice(match[0].length)
  }
  const lines = body.split(/\r?\n/).map((line) => line.trim())
  const heading = lines.find((line) => /^#\s+\S/.test(line))?.replace(/^#\s+/, '')
  const paragraph = lines.find((line) => line && !line.startsWith('#'))
  const name = metadata.name ?? heading
  if (!name) throw new Error('SKILL_DECLARATION_INVALID: name is missing')
  const executor = metadata.executor
  const executorId = typeof executor === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(executor)
    ? executor
    : null
  return {
    name,
    description: metadata.description ?? paragraph ?? '暂无描述',
    body,
    executorId
  }
}
