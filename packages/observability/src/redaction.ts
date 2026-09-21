/** Credential shaped fields that must never reach an interaction log, at any nesting depth. */
export const INTERACTION_REDACT_PATHS = [
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  '["x-api-key"]',
  'headers["x-api-key"]',
  'apiKey',
  '*.apiKey',
  'body.apiKey',
  'draft.apiKey',
  'apiKeyCipher',
  '*.apiKeyCipher',
  'token',
  '*.token',
  'serviceToken'
]
