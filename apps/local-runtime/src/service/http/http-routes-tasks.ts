import type { Hono } from 'hono'
import { z } from 'zod'
import { failure, invalid, success, validate } from './http-contract'

export type TaskRoutes = {
  taskControl: { execute(command: string, input: unknown): Promise<unknown> }
}

const taskInputSchema = z.object({ value: z.unknown() }).strict()

const appApprovalDecisionSchema = z
  .object({ decision: z.enum(['once', 'session', 'always', 'deny']) })
  .strict()

const skillControlSchema = z.object({ command: z.enum(['pause', 'resume', 'take-over']) }).strict()

const alwaysAllowedSchema = z.object({ bundleId: z.string().min(1).max(512) }).strict()
const sessionStateSchema = z.object({ value: z.boolean() }).strict()

export function registerTaskRoutes(app: Hono, options: TaskRoutes): void {
  const tasks = options.taskControl
  // Settings page: persisted "always allow" Computer Use grants live in the runtime store.
  app.get('/computer-use/always-allowed', async (context) =>
    context.json(success(await tasks.execute('computer-use.always-allowed.list', {})))
  )
  app.post(
    '/computer-use/always-allowed/remove',
    validate(alwaysAllowedSchema),
    async (context) => {
      const body = context.req.valid('json')
      return context.json(
        success(
          await tasks.execute('computer-use.always-allowed.remove', { bundleId: body.bundleId })
        )
      )
    }
  )
  app.get('/tasks', async (context) => {
    const limit = Number(context.req.query('limit') ?? 20)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return context.json(invalid(), 400)
    }
    return context.json(success(await tasks.execute('task.list', { limit })))
  })
  app.get('/sessions/catalog', async (context) => {
    const parsed = z
      .object({
        archived: z.enum(['true', 'false']),
        query: z.string().max(512).optional(),
        cursor: z
          .string()
          .min(1)
          .max(512)
          .regex(/^[A-Za-z0-9_-]+$/)
          .optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20)
      })
      .safeParse(context.req.query())
    if (!parsed.success) return context.json(invalid(), 400)
    try {
      return context.json(
        success(
          await tasks.execute('session.catalog', {
            ...parsed.data,
            archived: parsed.data.archived === 'true'
          })
        )
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid session catalog cursor')
        return context.json(invalid(), 400)
      throw error
    }
  })
  for (const action of ['pin', 'archive'] as const) {
    app.put(`/sessions/:sessionId/${action}`, validate(sessionStateSchema), async (context) => {
      try {
        return context.json(
          success(
            await tasks.execute(`session.${action}.set`, {
              sessionId: context.req.param('sessionId'),
              value: context.req.valid('json').value
            })
          )
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith('Unknown session:'))
          return context.json(failure('not-found', message), 404)
        if (message === 'Cannot archive a running or queued session')
          return context.json(failure('invalid-state', message), 409)
        return context.json(failure('internal-error', '会话状态更新失败，请重试'), 500)
      }
    })
  }
  app.get('/tasks/:taskId', async (context) =>
    context.json(success(await tasks.execute('task.get', { taskId: context.req.param('taskId') })))
  )
  app.post('/tasks/:taskId/interrupt', async (context) =>
    context.json(
      success(await tasks.execute('task.interrupt', { taskId: context.req.param('taskId') }))
    )
  )
  app.post('/tasks/:taskId/continue', async (context) =>
    context.json(
      success(await tasks.execute('task.continue', { taskId: context.req.param('taskId') }))
    )
  )
  app.post('/tasks/:taskId/input', validate(taskInputSchema), async (context) =>
    context.json(
      success(
        await tasks.execute('task.provide-input', {
          taskId: context.req.param('taskId'),
          value: context.req.valid('json').value
        })
      )
    )
  )
  app.post(
    '/tasks/:taskId/app-approvals/:approvalRequestId/decision',
    validate(appApprovalDecisionSchema),
    async (context) =>
      context.json(
        success(
          await tasks.execute('task.decide-app-approval', {
            taskId: context.req.param('taskId'),
            requestId: context.req.param('approvalRequestId'),
            decision: context.req.valid('json').decision
          })
        )
      )
  )
  app.post(
    '/skills/invocations/:invocationId/control',
    validate(skillControlSchema),
    async (context) =>
      context.json(
        success(
          await tasks.execute('skill.control', {
            invocationId: context.req.param('invocationId'),
            command: context.req.valid('json').command
          })
        )
      )
  )
}
