import { executeBrowserAuthCommand } from './service-auth-command.js'
import { createAuthHostAdapter } from './service-auth-host.js'
import { openAuthDocumentPermit, openAuthOrdinaryDocumentPermit } from './service-auth-document-permit.js'
import { prepareAuthCredentialDelivery } from './service-auth-delivery.js'
import { submitPrivateAuthForm } from './service-auth-private-form.js'
import { decodeAuthQrWithPage } from './service-auth-qr-page.js'
import { decodeAuthQrWithWasm } from './service-auth-qr-wasm.js'
import { startAuthQrPageWatch } from './service-auth-qr-monitor.js'

/** Route the original command through restored preflights and the ordinary host submission path. */
export async function handleBrowserAuthCommand(
  params: any, backend: any, _authorization?: unknown,
  finishNativeCredentialModelCommand?: () => void
) {
  const info = await backend.api.getInfo()
  const host = backend.playwright == null ? undefined : createAuthHostAdapter(backend)
  let ordinaryPermit: Awaited<ReturnType<typeof openAuthOrdinaryDocumentPermit>> | undefined
  let privatePermit: Awaited<ReturnType<typeof openAuthDocumentPermit>> | undefined
  let privateBinding: any
  let nativeDelivery = false
  let ordinaryEpoch: number | undefined
  const cleanupDelivery = async () => {
    if (privatePermit != null) {
      const permit = privatePermit
      privatePermit = undefined
      await permit.close()
    }
    if (ordinaryPermit == null) return
    const permit = ordinaryPermit
    ordinaryPermit = undefined
    await permit.close()
    if (ordinaryEpoch != null)
      backend.credentialObservationGate.allowOrdinaryInteraction(Number(params.tab_id), ordinaryEpoch)
  }
  return await executeBrowserAuthCommand(params, {
    clientInfo: {
      name: typeof info?.name === 'string' ? info.name : 'Browser',
      type: backend.clientInfo.type,
      capabilities: info?.capabilities
    },
    cdp: backend.cdp,
    playwright: backend.playwright,
    runtime: backend.runtime,
    environment: backend.environment,
    elicitationDisplayName: backend.elicitationDisplayName,
    ...(host == null ? {} : {
      auth: {
        inspectFields: host.inspectFields,
        validateForm: host.validateForm,
        validateOptions: host.validateOptions,
        canSubmit: host.canSubmit,
        ...(typeof backend.screenshot !== 'function' ? {} : {
          captureScreenshot: async () => {
            const screenshot = await backend.screenshot({ browser_id: params.browser_id, tab_id: params.tab_id })
            return { browserId: backend.browserId, tabId: params.tab_id,
              pageUrl: params.origin, url: `data:image/jpeg;base64,${screenshot.data}` }
          }
        }),
        decodeQr: async (screenshot: any) => {
          const decoded = await decodeAuthQrWithWasm(screenshot.url, backend)
          return (decoded !== undefined ? decoded : await decodeAuthQrWithPage(screenshot.url,
            params, { playwright: backend.playwright })) ?? undefined
        },
        watchQrCode: (publish: (payload: string, disappeared?: boolean) => void,
          details: { initialPayload: string; qrOnly: boolean; pageBindingStatus(): Promise<any> }) =>
          startAuthQrPageWatch({ tabId: params.tab_id, timeoutMs: params.timeout_ms, cdp: backend.cdp,
            playwright: backend.playwright, filesystem: backend.filesystem, publish, ...details }),
        prepareDelivery: async (submission: any, details: any) => {
          const wantsNative = submission.native_credential_delivery === true
          const wantsManual = submission.manual_credential_save === true ||
            submission.ordinary_credential_delivery === true
          if (wantsNative && !wantsManual) {
            if (details.credentialBinding == null ||
              backend.credentialObservationGate == null ||
              finishNativeCredentialModelCommand == null)
              throw Error('Native credential protection is unavailable')
            await prepareAuthCredentialDelivery(submission, {
              tabId: Number(params.tab_id), credentialBinding: details.credentialBinding,
              gate: backend.credentialObservationGate, cdp: backend.cdp,
              releaseCommand: finishNativeCredentialModelCommand
            })
            nativeDelivery = true
            return
          }
          const manual = details.manualSave
          if (manual == null || details.formFrameId == null ||
            backend.credentialObservationGate == null || backend.documentResponses == null ||
            finishNativeCredentialModelCommand == null)
            throw Error('Credential permit is unavailable')
          const password = submission.fields?.[manual.fields.password]
          if (typeof password !== 'string' || password.length === 0)
            throw Error('Browser credential submission is missing its password')
          await prepareAuthCredentialDelivery(submission, {
            tabId: Number(params.tab_id), credentialBinding: details.credentialBinding,
            manualSave: manual, hasFormBinding: true,
            gate: backend.credentialObservationGate, cdp: backend.cdp,
            releaseCommand: finishNativeCredentialModelCommand,
            onManualProtected: () => { ordinaryEpoch = backend.credentialObservationGate.epoch }
          })
          nativeDelivery = wantsNative
          if (manual.kind === 'private') {
            const username = submission.fields?.[manual.fields.username]
            if (typeof username !== 'string' || manual.submission == null)
              throw Error('Private credential submission is unavailable')
            privateBinding = manual
            privatePermit = await openAuthDocumentPermit({
              cdp: backend.cdp, requests: backend.documentResponses,
              tabId: Number(params.tab_id), frameId: details.formFrameId,
              target: manual.target,
              credentialFields: [
                { name: manual.names.username, value: username },
                { name: manual.names.password, value: password }
              ]
            })
          } else if (manual.kind === 'ordinary') {
            ordinaryPermit = await openAuthOrdinaryDocumentPermit({
              cdp: backend.cdp, requests: backend.documentResponses,
              tabId: Number(params.tab_id), frameId: details.pageFrameId,
              origin: params.origin, password
            })
          } else throw Error('Credential permit is unavailable')
        },
        cleanupDelivery,
        submitCredentials: async (values: Record<string, string>, selectedOption: string | undefined,
          revalidate?: () => Promise<any>, credentialPlan?: any, frameOrigin?: string) => {
          if (revalidate == null) return 'submission_failed' as const
          if (privatePermit != null) {
            const username = values[privateBinding.fields.username]
            const password = values[privateBinding.fields.password]
            if (username == null || password == null) return 'submission_failed' as const
            const result = await submitPrivateAuthForm(params.tab_id, params.timeout_ms,
              privateBinding.submission, { username, password }, backend.playwright,
              async () => privatePermit?.currentRejection() ?? await revalidate())
            return result === 'submitted'
              ? await privatePermit.result(params.timeout_ms ?? 5000) : result
          }
          const result = await host.submitCredentials({ ...params, origin: frameOrigin ?? params.origin }, values, selectedOption,
            async () => ordinaryPermit?.currentRejection() ?? await revalidate(),
            { nativeDelivery, credentialPlan })
          if (result !== 'submitted' || ordinaryPermit == null) return result
          return await ordinaryPermit.ordinaryResult()
        }
      }
    })
  })
}

export const authCommandHandlers = {
  tab_browser_auth_handoff: handleBrowserAuthCommand
}
