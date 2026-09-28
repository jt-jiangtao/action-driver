interface AuthDeliverySubmission {
  native_credential_delivery?: boolean
  ordinary_credential_delivery?: boolean
  manual_credential_save?: boolean
}
interface AuthDeliveryContext {
  tabId: number
  credentialBinding?: { submission?: string }
  manualSave?: { kind: 'private' | 'ordinary' }
  hasFormBinding?: boolean
  releaseCommand?: () => void
  onManualProtected?: () => void
  gate?: {
    protect(tabId: number, release?: () => void): Promise<unknown>
    protectManualSaving(tabId: number, release?: () => void): Promise<unknown>
  }
  cdp: { protectBrowserAuthCredentialDiagnostics(tabId: number): void }
}
/** Establish observation protection before the handler exposes values to page or native delivery. */
export async function prepareAuthCredentialDelivery(
  submission: AuthDeliverySubmission,
  context: AuthDeliveryContext
) {
  const nativeDelivery = submission.native_credential_delivery === true
  const ordinaryDelivery = submission.ordinary_credential_delivery === true
  const manualSave = submission.manual_credential_save === true
  if (manualSave && (context.manualSave == null || !context.hasFormBinding))
    throw Error('Manual credential saving is unavailable')
  if ((ordinaryDelivery && (manualSave || nativeDelivery ||
    context.credentialBinding?.submission !== 'ordinary' ||
    context.manualSave?.kind !== 'ordinary')) ||
    (nativeDelivery && context.credentialBinding?.submission === 'ordinary'))
    throw Error('Credential delivery mode is unavailable')
  const needsManualProtection = manualSave || ordinaryDelivery
  if (needsManualProtection &&
    (context.manualSave == null || !context.hasFormBinding || context.gate == null))
    throw Error('Credential submission protection is unavailable')
  if (nativeDelivery && (context.credentialBinding == null || context.gate == null))
    throw Error('Native credential observation protection is unavailable')
  if (needsManualProtection) {
    await context.gate!.protectManualSaving(context.tabId, context.releaseCommand)
    context.cdp.protectBrowserAuthCredentialDiagnostics(context.tabId)
    context.onManualProtected?.()
  }
  if (nativeDelivery) await context.gate!.protect(context.tabId, context.releaseCommand)
  return { nativeDelivery, manualSave, ordinaryDelivery }
}
