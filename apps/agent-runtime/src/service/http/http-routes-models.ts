import type { Hono } from 'hono'
import { z } from 'zod'
import type { ModelRef } from '@actiondriver/contracts'
import type {
  ModelAddRequestDto,
  ModelConnectionDto,
  ModelConnectionDraftDto,
  ModelConnectionTestRequestDto,
  ModelConnectionTestResultDto,
  ModelOptionDto,
  ModelSetEnabledRequestDto,
  ModelTestRequestDto,
  ModelTestResultDto
} from '@actiondriver/model-connections'
import { enabledSchema, id, success, validate } from './http-contract'

export type ModelConnectionRoutes = {
  service: {
    list(): Promise<ModelConnectionDto[]>
    testConnection(draft: ModelConnectionDraftDto): Promise<ModelConnectionTestResultDto>
    discover(draft: ModelConnectionDraftDto): Promise<ModelOptionDto[]>
    refresh(connectionId: string): Promise<ModelOptionDto[]>
    testModels(request: ModelTestRequestDto): Promise<ModelTestResultDto[]>
    testConnectionModels(request: ModelConnectionTestRequestDto): Promise<ModelTestResultDto[]>
    setModelEnabled(request: ModelSetEnabledRequestDto): Promise<void>
    setDefaultImageModel(model: ModelRef | null): Promise<void>
    getDefaultImageModel(): Promise<ModelRef | null>
    add(request: ModelAddRequestDto): Promise<ModelConnectionDto>
    delete(connectionId: string): Promise<void>
  }
}

const draftSchema = z
  .object({
    name: id,
    protocol: z.enum(['openai-compatible', 'anthropic']),
    baseUrl: z.url(),
    apiKey: id
  })
  .strict()

const modelSchema = z
  .object({
    id,
    name: id,
    enabled: z.boolean(),
    testState: z.enum(['untested', 'testing', 'success', 'failed', 'unsupported']),
    imageInputEnabled: z.boolean().optional(),
    imageGenerationEnabled: z.boolean().optional(),
    kind: z.enum(['chat', 'image']).optional(),
    imageGenerationApi: z.enum(['openai-images', 'token-plan']).optional(),
    capabilities: z
      .partialRecord(
        z.enum(['text', 'reasoning', 'vision', 'image_generation']),
        z.object({
          state: z.enum([
            'untested',
            'testing',
            'success',
            'unsupported',
            'failed',
            'inconclusive'
          ]),
          source: z.enum(['catalog', 'probe', 'legacy']),
          testedAt: z.string().optional(),
          failure: z
            .object({
              code: z.enum([
                'unauthorized',
                'not-found',
                'model-not-found',
                'rate-limited',
                'provider-error',
                'network',
                'timeout',
                'cancelled',
                'invalid-request',
                'invalid-response',
                'secret-unavailable',
                'storage-error',
                'unknown'
              ]),
              message: z.string()
            })
            .optional()
        })
      )
      .optional(),
    catalogLabels: z.array(z.string()).optional()
  })
  .strict()

const addSchema = z.object({ draft: draftSchema, models: z.array(modelSchema) }).strict()

const testModelsSchema = z
  .object({
    draft: draftSchema,
    modelIds: z.array(id)
  })
  .strict()

const connectionModelsSchema = z.object({ modelIds: z.array(id) }).strict()

const imageModelSchema = z.object({ connectionId: id, modelId: id }).strict()

const defaultImageModelSchema = z.object({ model: imageModelSchema.nullable() }).strict()

export function registerModelConnectionRoutes(app: Hono, options: ModelConnectionRoutes): void {
  const service = options.service
  app.get('/model-connections', async (context) => context.json(success(await service.list())))
  app.get('/model-connections/default-image-model', async (context) =>
    context.json(success(await service.getDefaultImageModel()))
  )
  app.post(
    '/model-connections/default-image-model',
    validate(defaultImageModelSchema),
    async (context) => {
      await service.setDefaultImageModel(context.req.valid('json').model)
      return context.json(success(null))
    }
  )
  app.post('/model-connections', validate(addSchema), async (context) =>
    context.json(success(await service.add(context.req.valid('json'))))
  )
  app.post('/model-connections/test', validate(draftSchema), async (context) =>
    context.json(success(await service.testConnection(context.req.valid('json'))))
  )
  app.post('/model-connections/discover', validate(draftSchema), async (context) =>
    context.json(success(await service.discover(context.req.valid('json'))))
  )
  app.post('/model-connections/test-models', validate(testModelsSchema), async (context) =>
    context.json(success(await service.testModels(context.req.valid('json'))))
  )
  app.post('/model-connections/:connectionId/refresh', async (context) =>
    context.json(success(await service.refresh(context.req.param('connectionId'))))
  )
  app.post(
    '/model-connections/:connectionId/test-models',
    validate(connectionModelsSchema),
    async (context) =>
      context.json(
        success(
          await service.testConnectionModels({
            connectionId: context.req.param('connectionId'),
            modelIds: context.req.valid('json').modelIds
          })
        )
      )
  )
  app.post(
    '/model-connections/:connectionId/models/:modelId',
    validate(enabledSchema),
    async (context) => {
      await service.setModelEnabled({
        connectionId: context.req.param('connectionId'),
        modelId: context.req.param('modelId'),
        enabled: context.req.valid('json').enabled
      })
      return context.json(success(null))
    }
  )
  app.delete('/model-connections/:connectionId', async (context) => {
    await service.delete(context.req.param('connectionId'))
    return context.json(success(null))
  })
}
