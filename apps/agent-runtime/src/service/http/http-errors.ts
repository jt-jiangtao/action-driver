import { ModelServiceError } from '@actiondriver/model-connections'
import { PluginError } from '@actiondriver/plugin-contracts'
import { AgentFileStoreError } from '../../agent-files/agent-file-store'
import { AppApprovalError } from '../../computer-use/app-approval-broker'
import { AssetError } from '../../media/session-asset-store'

export type MappedHttpError = {
  status: 200 | 400 | 403 | 404 | 409 | 500
  code: string
  message: string
}

/**
 * Maps thrown domain errors to the HTTP envelope the client already expects. Order is
 * part of the contract: a domain error never leaks as a generic 500.
 */
export function mapErrorToResponse(error: unknown): MappedHttpError {
  if (error instanceof PluginError) {
    return {
      status:
        error.code === 'AUTHORIZATION_DENIED'
          ? 403
          : error.code === 'STALE_INSTANCE'
            ? 409
            : error.code === 'UNAVAILABLE'
              ? 404
              : 400,
      code: error.code,
      message: error.message
    }
  }
  if (error instanceof AppApprovalError) {
    return {
      status: error.code === 'APPROVAL_STALE' ? 409 : 400,
      code: error.code,
      message: error.message
    }
  }
  if (error instanceof ModelServiceError) {
    return { status: 200, code: error.code, message: error.message }
  }
  if (error instanceof AssetError) {
    return {
      status:
        error.code === 'ASSET_NOT_FOUND' || error.code === 'ASSET_SESSION_MISMATCH' ? 404 : 400,
      code: error.code,
      message: error.message
    }
  }
  if (error instanceof AgentFileStoreError) {
    return {
      status: error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 400,
      code: error.code,
      message: error.message
    }
  }
  return {
    status: 500,
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error)
  }
}
