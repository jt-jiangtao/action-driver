import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
let loaded: Promise<any> | undefined
export function originalClient() {
  return (loaded ??= (async () => {
    const source = await readFile(
      resolve(
        'thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.js'
      ),
      'utf8'
    )
    return import(
      'data:text/javascript;base64,' +
        Buffer.from(
          source +
            '\nexport {s as baselineApi,a as baselineDisplay,mm as BaselineApiFactory,Ul as BaselineCapabilities,Ll as BaselineBrowserCapability,ql as BaselineTabCapability,Bl as baselineBrowserRegistration,Fl as baselineTabRegistration,oh as baselineTabFactories,im as baselineBrowserFactories};'
        ).toString('base64')
    )
  })())
}
