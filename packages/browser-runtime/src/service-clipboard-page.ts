/** Self-contained browser realm code; serialization must not capture module state. */
export function installPageClipboardBridge(bindingName: string): void {
  const world = globalThis as typeof globalThis & Record<string, any>,
    previous = world.__browserUseClipboardBridge
  if (previous?.bindingName === bindingName) return
  previous?.cleanup()
  const binding = world[bindingName]
  if (typeof binding !== 'function') throw Error('Browser Use clipboard bridge is unavailable')
  const original = navigator.clipboard,
    hadOwn = Object.hasOwn(navigator, 'clipboard'),
    descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
    pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  let sequence = 0
  const encode = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer)
    let text = ''
    for (let offset = 0; offset < bytes.length; offset += 32768)
      text += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
    return btoa(text)
  }
  const decode = (value: string) => {
    const text = atob(value),
      bytes = new Uint8Array(text.length)
    for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index)
    return bytes.buffer
  }
  const blob = (entry: any) =>
    new Blob([typeof entry.text === 'string' ? entry.text : decode(entry.base64 ?? '')], {
      type: entry.mime_type
    })
  const item = (wire: any) =>
    typeof ClipboardItem === 'function'
      ? new ClipboardItem(
          Object.fromEntries(wire.entries.map((entry: any) => [entry.mime_type, blob(entry)])),
          { presentationStyle: wire.presentation_style ?? 'unspecified' }
        )
      : {
          types: wire.entries.map((entry: any) => entry.mime_type),
          presentationStyle: wire.presentation_style ?? 'unspecified',
          getType: async (type: string) => {
            const entry = wire.entries.find((entry: any) => entry.mime_type === type)
            if (entry == null)
              throw new DOMException(`No clipboard entry for ${type}`, 'NotFoundError')
            return blob(entry)
          }
        }
  const serialize = async (items: Iterable<any>) =>
    await Promise.all(
      Array.from(items).map(async (item: any) => ({
        entries: await Promise.all(
          item.types.map(async (type: string) => {
            const value = await item.getType(type)
            return type.startsWith('text/')
              ? { mime_type: type, text: await value.text() }
              : { mime_type: type, base64: encode(await value.arrayBuffer()) }
          })
        ),
        presentation_style: item.presentationStyle ?? 'unspecified'
      }))
    )
  const request = (operation: string, items?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      try {
        binding(JSON.stringify({ id, items, operation }))
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : Error(String(error)))
      }
    })
  const assertReceiver = (receiver: unknown) => {
    if (receiver !== clipboard) throw new TypeError('Illegal invocation')
  }
  const methods = {
    read: async function (this: unknown) {
      assertReceiver(this)
      return (await request('read')).map(item)
    },
    readText: async function (this: unknown) {
      assertReceiver(this)
      const entry = (await request('read'))
        .flatMap((item: any) => item.entries)
        .find((entry: any) => entry.mime_type === 'text/plain')
      return entry == null ? '' : await blob(entry).text()
    },
    write: async function (this: unknown, items: Iterable<any>) {
      assertReceiver(this)
      if (arguments.length === 0)
        throw new TypeError("Failed to execute 'write' on 'Clipboard': 1 argument required")
      const wire = await serialize(items)
      if (wire.length !== 0) await request('write', wire)
    },
    writeText: async function (this: unknown, text: unknown) {
      assertReceiver(this)
      if (arguments.length === 0)
        throw new TypeError("Failed to execute 'writeText' on 'Clipboard': 1 argument required")
      await request('write', [
        {
          entries: [{ mime_type: 'text/plain', text: `${text}` }],
          presentation_style: 'unspecified'
        }
      ])
    }
  }
  let clipboard: any = {
      ...methods,
      addEventListener: () => {},
      dispatchEvent: () => true,
      removeEventListener: () => {}
    },
    patched: any
  const getter = { configurable: true, get: () => clipboard },
    saved = new Map<string, PropertyDescriptor | undefined>()
  const unpatch = () => {
    if (patched !== undefined) {
      for (const [key, descriptor] of saved)
        if (
          Object.getOwnPropertyDescriptor(patched, key)?.value ===
          methods[key as keyof typeof methods]
        ) {
          if (descriptor === undefined) Reflect.deleteProperty(patched, key)
          else Object.defineProperty(patched, key, descriptor)
        }
      patched = undefined
      saved.clear()
    }
  }
  const patch = (object: any) => {
    patched = object
    try {
      for (const key of Object.keys(methods)) {
        saved.set(key, Object.getOwnPropertyDescriptor(object, key))
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: true,
          value: methods[key as keyof typeof methods],
          writable: true
        })
      }
      return true
    } catch {
      unpatch()
      return false
    }
  }
  if (original != null) {
    const prototype = Object.getPrototypeOf(original)
    if (
      patch(original) ||
      (prototype != null &&
        Object.keys(methods).every((key) => key in prototype) &&
        patch(prototype))
    )
      clipboard = original
    else Object.defineProperty(navigator, 'clipboard', getter)
  } else Object.defineProperty(navigator, 'clipboard', getter)
  const cleanup = () => {
    if (world.__browserUseClipboardBridge?.bindingName !== bindingName) return
    for (const frame of document.querySelectorAll('iframe,frame'))
      if (frame instanceof HTMLIFrameElement || frame instanceof HTMLFrameElement)
        frame.contentWindow?.postMessage(bindingName, '*')
    world.removeEventListener('message', message)
    for (const waiter of pending.values())
      waiter.reject(Error('Browser Use clipboard bridge was removed'))
    pending.clear()
    if (patched !== undefined) unpatch()
    else if (Object.getOwnPropertyDescriptor(navigator, 'clipboard')?.get === getter.get) {
      if (hadOwn && descriptor !== undefined)
        Object.defineProperty(navigator, 'clipboard', descriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
    delete world.__browserUseClipboardBridge
    if (world[bindingName] === binding) Reflect.deleteProperty(world, bindingName)
  }
  const message = (event: MessageEvent) => {
    if (
      event.data === bindingName &&
      ((event.source as unknown) === world || event.source === world.parent)
    )
      cleanup()
  }
  world.__browserUseClipboardBridge = {
    bindingName,
    cleanup,
    respond: (payload: string) => {
      let response: any
      try {
        response = JSON.parse(payload)
      } catch {
        return
      }
      const waiter = pending.get(response.id)
      if (waiter !== undefined) {
        pending.delete(response.id)
        if (response.ok) waiter.resolve(Array.isArray(response.items) ? response.items : [])
        else waiter.reject(Error(response.error ?? 'Clipboard request failed'))
      }
    }
  }
  world.addEventListener('message', message)
}
export const clipboardInstallScript = (binding: string) =>
  `(() => { const __name = (target) => target; const install = ${installPageClipboardBridge.toString()}; install(${JSON.stringify(binding)}); })()`
export const clipboardCleanupScript = (binding: string) =>
  `globalThis.__browserUseClipboardBridge?.bindingName === ${JSON.stringify(binding)} && globalThis.__browserUseClipboardBridge.cleanup()`
export const clipboardResponseScript = (response: unknown) =>
  `globalThis.__browserUseClipboardBridge?.respond(${JSON.stringify(JSON.stringify(response))})`
