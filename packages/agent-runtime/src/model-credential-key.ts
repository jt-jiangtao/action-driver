/** Credential names accepted by providers vary in case and separators. */
export function isModelCredentialKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized === 'apikey' ||
    normalized === 'xapikey' ||
    normalized === 'authorization' ||
    normalized === 'proxyauthorization' ||
    normalized === 'cookie' ||
    normalized === 'cookies' ||
    normalized === 'setcookie' ||
    normalized === 'password' ||
    normalized === 'passphrase' ||
    normalized === 'secret' ||
    normalized.endsWith('secret') ||
    normalized === 'privatekey' ||
    normalized === 'credentials'
  )
}
