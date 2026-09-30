import type { Hono } from 'hono'
import { z } from 'zod'
import { invalid, success, validate } from './http-contract'

export type TaskRoutes = {
  taskControl: { execute(command: string, input: unknown): Promise<unknown> }
}

const taskInputSchema = z.object({ value: z.unknown() }).strict()

const appApprovalDecisionSchema = z
  .object({ decision: z.enum(['once', 'session', 'always', 'deny']) })
  .strict()

const skillControlSchema = z.object({ command: z.enum(['pause', 'resume', 'take-over']) }).strict()

const alwaysAllowedSchema = z.object({ bundleId: z.string().min(1).max(512) }).strict()

export function registerTaskRoutes(app: Hono, options: TaskRoutes): void {
  const tasks = options.taskControl
  // Settings page: persisted "always allow" Computer Use grants live in the runtime store.
  app.get('/computer-use/always-allowed', async (context) =>
    context.json(success(await tasks.execute('computer-use.always-allowed.list', {})))
  )
  app.post('/computer-use/always-allowed/remove', validate(alwaysAllowedSchema), async (context) => {
    const body = context.req.valid('json')
    return context.json(
      success(await tasks.execute('computer-use.always-allowed.remove', { bundleId: body.bundleId }))
    )
  })
  app.get('/tasks', async (context) => {
    const limit = Number(context.req.query('limit') ?? 20)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return context.json(invalid(), 400)
    }
    return context.json(success(await tasks.execute('task.list', { limit })))
  })
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
