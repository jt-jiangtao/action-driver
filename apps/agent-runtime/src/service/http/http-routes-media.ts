import type { Hono } from 'hono'
import { MAX_IMAGE_BYTES, type SessionAssetStore } from '../../media/session-asset-store'
import {
  InputFileError,
  MAX_INPUT_FILE_BYTES,
  type SessionInputFileStore
} from '../../media/session-input-file-store'
import { OutputStoreError, type SessionOutputStore } from '../../media/session-output-store'
import { failure, success } from './http-contract'
import { readLimitedBytes } from './http-utils'

export type MediaRoutes = {
  assets?: SessionAssetStore
  inputFiles?: SessionInputFileStore
  outputs?: SessionOutputStore
}

export function registerMediaRoutes(app: Hono, options: MediaRoutes): void {
  const assets = options.assets
  if (assets) {
    app.post('/assets/staged', async (context) => {
      const bytes = await readLimitedBytes(context.req.raw, MAX_IMAGE_BYTES)
      if (!bytes) return context.json(failure('invalid-request', 'Image is too large'), 413)
      return context.json(success(await assets.stageUpload(bytes)))
    })
    app.get('/sessions/:sessionId/assets/:assetId', async (context) => {
      const { bytes, mimeType } = await assets.read(
        context.req.param('assetId'),
        context.req.param('sessionId')
      )
      return context.body(new Uint8Array(bytes), 200, {
        'Content-Type': mimeType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      })
    })
  }
  const inputFiles = options.inputFiles
  if (inputFiles) {
    app.post('/input-files/staged', async (context) => {
      const rawName = context.req.header('x-actiondriver-file-name')
      let name = ''
      try {
        name = decodeURIComponent(rawName ?? '')
      } catch {
        return context.json(failure('INPUT_FILE_NAME_INVALID', 'File name is invalid'), 400)
      }
      if (!name)
        return context.json(failure('INPUT_FILE_NAME_INVALID', 'File name is required'), 400)
      const bytes = await readLimitedBytes(context.req.raw, MAX_INPUT_FILE_BYTES)
      if (!bytes) return context.json(failure('INPUT_FILE_TOO_LARGE', 'File is too large'), 413)
      try {
        return context.json(
          success(
            await inputFiles.stageUpload({
              bytes,
              name,
              mimeType: context.req.header('content-type') ?? 'application/octet-stream'
            })
          )
        )
      } catch (error) {
        if (error instanceof InputFileError) {
          return context.json(failure(error.code, error.message), 400)
        }
        throw error
      }
    })
  }
  const outputs = options.outputs
  if (outputs) {
    app.get('/sessions/:sessionId/outputs/:fileId/content', async (context) => {
      const taskId = context.req.query('taskId')
      if (!taskId) return context.json(failure('OUTPUT_FILE_NOT_FOUND', 'Task id is required'), 400)
      try {
        const file = await outputs.readSnapshot({
          fileId: context.req.param('fileId'),
          taskId,
          sessionId: context.req.param('sessionId')
        })
        return context.body(new Uint8Array(file.bytes), 200, {
          'Content-Type': file.mimeType,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff'
        })
      } catch (error) {
        if (error instanceof OutputStoreError) {
          return context.json(
            failure(error.code, error.message),
            error.code === 'OUTPUT_FILE_NOT_FOUND' ? 404 : 400
          )
        }
        throw error
      }
    })
  }
}
