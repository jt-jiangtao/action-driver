// @vitest-environment node
import { expect, test } from 'vitest'
import * as locators from '../src/locator'
import * as pages from '../src/playwright'
import { originalClient } from './original-client'
test('browser constructors ignore unrelated enumerable accessors', async () => {
  const { baselineApi } = await originalClient()
  const own = { ...locators, ...pages }
  function exercise(api: any) {
    const options = {
      browserId: 'b',
      tabId: 't',
      selector: 'div',
      frameSelector: 'iframe',
      downloadId: 'd',
      fileChooserId: 'f',
      isMultiple: true,
      transport: {
        async send() {
          return {}
        },
        async display() {}
      }
    }
    Object.defineProperty(options, 'unrelated', {
      enumerable: true,
      get() {
        throw new Error('unrelated getter must not run')
      }
    })
    return [
      'PlaywrightLocator',
      'PlaywrightFrameLocator',
      'PlaywrightDownload',
      'PlaywrightAPI',
      'PlaywrightFileChooser'
    ].map((name) => {
      try {
        return { name, keys: Reflect.ownKeys(new api[name](options)) }
      } catch (e) {
        return (e as Error).message
      }
    })
  }
  expect(exercise(own)).toEqual(exercise(baselineApi))
})
