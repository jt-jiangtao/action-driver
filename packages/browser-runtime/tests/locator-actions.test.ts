// @vitest-environment node
import { expect, test } from 'vitest'
import { PlaywrightLocator } from '../src/locator'
import { originalClient } from './original-client'
async function compare(run: (Ctor: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  expect(await run(PlaywrightLocator)).toEqual(await run(baselineApi.PlaywrightLocator))
}
function fixture(Ctor: any, failure?: unknown, diagnosticFailure = false) {
  const calls: any[] = []
  let read = 0
  const elements = [
    {
      tagName: 'BUTTON',
      getAttribute: (key: string) => (key === 'role' ? 'button' : null),
      textContent: '  hello  ',
      getClientRects: () => [{}],
      disabled: true
    },
    { tagName: 'DIV', getAttribute: () => null, textContent: null, getClientRects: () => [] }
  ]
  const transport = {
    async send(request: any) {
      const json = request.command.toJSON()
      if (json.type === 'playwright_evaluate') {
        // Diagnostic script formatting is intentionally not compared. Execute both scripts on the same DOM fixture.
        const { script, ...rest } = json
        calls.push({ json: rest, timeoutMs: request.timeoutMs })
        if (diagnosticFailure) throw new Error('diagnostic unavailable')
        return {
          value: await new (Object.getPrototypeOf(async function () {}).constructor)(
            'elements',
            script
          )(elements)
        }
      }
      calls.push({ json, timeoutMs: request.timeoutMs })
      if (json.type.endsWith('_count')) return { count: 2 }
      if (json.type.endsWith('_read_all'))
        return {
          values: [{ inner_text: `read-${++read}`, text_content: 'text', attributes: {} }, null]
        }
      if (failure !== undefined) throw failure
      return { path: '/tmp/media' }
    },
    async display() {}
  }
  return { calls, root: new Ctor({ browserId: 'b', tabId: 't', selector: 'button', transport }) }
}
test('all locator actions preserve command payloads, defaults and return projection', async () => {
  await compare(async (Ctor) => {
    const { root, calls } = fixture(Ctor)
    const results = [
      await root.click({ modifiers: ['Shift'], button: 'right', force: true, timeoutMs: 20 }),
      await root.dblclick(),
      await root.fill(''),
      await root.type('text', { timeoutMs: 30 }),
      await root.press('Enter'),
      await root.pressSequentially('abc'),
      await root.pressSequentially('abc', { timeoutMs: 40 }),
      await root.selectOption(['x', { label: 'X', index: 0, ignored: 1 }]),
      await root.setChecked(false, { force: true }),
      await root.check(),
      await root.uncheck({ timeoutMs: 20 }),
      await root.waitFor({ state: 'visible', timeoutMs: 50 }),
      await root.downloadMedia(),
      await root.downloadMedia({ timeoutMs: 60 })
    ]
    return { calls, results }
  })
})
test('invalid selection, values, check state and wait state reject before transport', async () => {
  await compare(async (Ctor) => {
    const { root, calls } = fixture(Ctor),
      errors = []
    for (const action of [
      () => root.fill(null),
      () => root.type(undefined),
      () => root.press(null),
      () => root.pressSequentially(null),
      () => root.setChecked('yes'),
      () => root.waitFor({}),
      ...[[], null, {}, 1, { value: 1 }, { label: 1 }, { index: -1 }, { index: 1.2 }].map(
        (value) => () => root.selectOption(value)
      )
    ]) {
      try {
        await action()
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { calls, errors }
  })
})
test('successful mutations invalidate shared cache; waitFor preserves cached reads', async () => {
  await compare(async (Ctor) => {
    const { root, calls } = fixture(Ctor),
      [one] = await root.all(),
      values = []
    for (const action of [
      () => one.click(),
      () => one.dblclick(),
      () => one.fill('a'),
      () => one.type('b'),
      () => one.press('Enter'),
      () => one.pressSequentially('x'),
      () => one.selectOption('a'),
      () => one.setChecked(true),
      () => one.downloadMedia()
    ]) {
      values.push(await one.innerText())
      await action()
      values.push(await one.innerText())
    }
    values.push(await one.innerText())
    await one.waitFor({ state: 'visible' })
    values.push(await one.innerText())
    return { calls, values }
  })
})
test('action failures include executed DOM diagnostics and preserve original error context', async () => {
  for (const failure of [
    new Error('strict mode violation'),
    new Error('receives pointer events'),
    new Error('offline'),
    'primitive failure'
  ]) {
    await compare(async (Ctor) => {
      const { root, calls } = fixture(Ctor, failure),
        errors = []
      for (const action of [
        () => root.click(),
        () => root.dblclick(),
        () => root.fill('a'),
        () => root.type('a'),
        () => root.press('Enter'),
        () => root.pressSequentially('a'),
        () => root.selectOption('a'),
        () => root.setChecked(true),
        () => root.waitFor({ state: 'visible' }),
        () => root.downloadMedia()
      ]) {
        try {
          await action()
        } catch (e) {
          errors.push((e as Error).message)
        }
      }
      return { calls, errors }
    })
  }
})
test('diagnostic failure falls back to action context without swallowing original error', async () => {
  await compare(async (Ctor) => {
    const { root, calls } = fixture(Ctor, new Error('offline'), true)
    try {
      await root.click()
    } catch (e) {
      return { calls, message: (e as Error).message }
    }
  })
})

test('diagnostic DOM reads keep count-before-summary evaluation order', async () => {
  await compare(async (Ctor) => {
    const visits: string[] = []
    const element = {
      get tagName() {
        visits.push('tag')
        return 'BUTTON'
      },
      getAttribute(key: string) {
        visits.push(key)
        return null
      },
      get textContent() {
        visits.push('text')
        return 'yes'
      },
      getClientRects() {
        visits.push('rect')
        return [{}]
      }
    }
    const transport = {
      async send(request: any) {
        const json = request.command.toJSON()
        if (json.type === 'playwright_evaluate')
          return {
            value: await new (Object.getPrototypeOf(async function () {}).constructor)(
              'elements',
              json.script
            )([element])
          }
        throw new Error('offline')
      },
      async display() {}
    }
    const root = new Ctor({ browserId: 'b', tabId: 't', selector: 'button', transport })
    try {
      await root.click()
    } catch {}
    return visits
  })
})
test('failed action retains shared collection cache', async () => {
  await compare(async (Ctor) => {
    const { root, calls } = fixture(Ctor, new Error('offline')),
      [one] = await root.all()
    const before = await one.innerText()
    try {
      await one.click()
    } catch {}
    return { before, after: await one.innerText(), calls }
  })
})
test('diagnostics classify missing, invisible and truncated matches', async () => {
  for (const scenario of ['missing', 'invisible', 'truncated']) {
    await compare(async (Ctor) => {
      const element = {
        tagName: 'DIV',
        getAttribute: () => null,
        textContent: 'x',
        getClientRects: () => (scenario === 'invisible' ? [] : [{}])
      }
      const elements =
        scenario === 'missing'
          ? []
          : Array.from({ length: scenario === 'truncated' ? 7 : 1 }, () => element)
      const transport = {
        async send(request: any) {
          const json = request.command.toJSON()
          if (json.type === 'playwright_evaluate')
            return {
              value: await new (Object.getPrototypeOf(async function () {}).constructor)(
                'elements',
                json.script
              )(elements)
            }
          throw new Error('offline')
        },
        async display() {}
      }
      const root = new Ctor({ browserId: 'b', tabId: 't', selector: 'button', transport })
      try {
        await root.click()
      } catch (e) {
        const message = (e as Error).message
        expect(message).toContain('Locator diagnostics: ')
        const details = JSON.parse(message.split('Locator diagnostics: ')[1])
        expect(details.kind).toBe(
          scenario === 'missing'
            ? 'no_matches'
            : scenario === 'invisible'
              ? 'no_visible_match'
              : 'action_failed'
        )
        expect(details.truncated).toBe(scenario === 'truncated')
        return details
      }
    })
  }
})
test('action option access failures still run diagnostics and retain context', async () => {
  for (const options of [
    null,
    Object.defineProperties(
      {},
      {
        modifiers: {
          get() {
            throw new Error('bad modifiers')
          }
        },
        force: {
          get() {
            throw new Error('bad force')
          }
        },
        timeoutMs: {
          get() {
            throw new Error('bad timeout')
          }
        }
      }
    )
  ]) {
    await compare(async (Ctor) => {
      const { root, calls } = fixture(Ctor),
        errors = []
      for (const action of [
        () => root.click(options),
        () => root.dblclick(options),
        () => root.pressSequentially('x', options),
        () => root.setChecked(true, options)
      ]) {
        try {
          await action()
        } catch (e) {
          errors.push((e as Error).message)
        }
      }
      return { calls, errors }
    })
  }
})
