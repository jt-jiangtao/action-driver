import type { BrowserCdp } from './service-cdp.js'
import type { DomFrame, ViewportClip } from './service-dom-state.js'
import { DomSnapshotState } from './service-dom-state.js'
import { visibleDomExpression } from './service-visible-dom-page.js'
type Cdp = Pick<
  BrowserCdp,
  'call' | 'callTarget' | 'targetForFrameOrAttach' | 'addTabCleanupHandler'
>
interface Reviewer {
  capturedFrameIds: Set<string>
  nextNodeId: number
}
interface Options {
  credentialFrameId?: string
  reviewer?: Reviewer
  timeoutMs?: number
}
interface FrameElement {
  ref: string
  rect: ViewportClip
  size?: { width: number; height: number }
  url?: string
}
interface PageResult {
  frameElements: FrameElement[]
  items: { ref: string; line: string }[]
  viewport: ViewportClip
}
interface Output {
  chars: number
  lines: string[]
  reviewer?: Reviewer
}
interface Work {
  frame: DomFrame
  childDeadline: number
  deadline?: number | undefined
  tabId: number
  clip?: ViewportClip | undefined
  output: Output
  maxChars?: number
  maxElements?: number
  requestDeadline?: boolean
}
const maxChars = 20000,
  maxElements = 200,
  childTimeout = 500,
  budget = 1000
const object = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object'
function rect(value: unknown): value is ViewportClip {
  return (
    object(value) &&
    ['left', 'top', 'right', 'bottom'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key])
    )
  )
}
function intersection(a: ViewportClip, b: ViewportClip) {
  const result = {
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom)
  }
  return result.right > result.left && result.bottom > result.top ? result : null
}
function childClip(a: ViewportClip, b: ViewportClip) {
  const overlap = intersection(a, b)
  return overlap == null
    ? null
    : {
        left: overlap.left - a.left,
        right: overlap.right - a.left,
        top: overlap.top - a.top,
        bottom: overlap.bottom - a.top
      }
}
function validSize(value: unknown) {
  return (
    object(value) &&
    ['width', 'height'].every(
      (key) =>
        typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) > 0
    )
  )
}
function decode(value: unknown): PageResult | null {
  if (!object(value) || !Array.isArray(value.items) || value.viewport == null) return null
  const frames = Array.isArray(value.frameElements)
    ? value.frameElements.filter(
        (frame): frame is FrameElement =>
          object(frame) &&
          typeof frame.ref === 'string' &&
          rect(frame.rect) &&
          (frame.size == null || validSize(frame.size)) &&
          (frame.url == null || typeof frame.url === 'string')
      )
    : []
  return {
    frameElements: frames,
    items: value.items.filter(
      (item): item is { ref: string; line: string } =>
        object(item) && typeof item.ref === 'string' && typeof item.line === 'string'
    ),
    viewport: value.viewport as ViewportClip
  }
}
const remaining = (deadline: number | undefined) =>
    deadline == null ? undefined : Math.max(1, deadline - Date.now()),
  childRemaining = (deadline: number) => Math.max(1, Math.min(childTimeout, deadline - Date.now())),
  room = (output: Output) => output.lines.length < maxElements && output.chars < maxChars
/** Shares reference state with CUA input; first-party frame traversal and budget enforcement. */
export class VisibleDomSnapshot {
  constructor(
    private cdp: Cdp,
    public state = new DomSnapshotState()
  ) {}
  private async resolveFrame(frame: DomFrame, ref: string, timeout: number, reviewer: boolean) {
    const expression = `(() => { const __name = (target) => target; const state = globalThis.${reviewer ? '__browserUseReviewerVisibleDomState' : '__browserUseVisibleDomState'}; return state?.refToElement?.get(${JSON.stringify(ref)}) ?? null; })()`
    const result = await this.state.evaluate(
      this.cdp,
      frame.target,
      frame.frameId,
      frame.loaderId,
      expression,
      { returnByValue: false, timeoutMs: timeout }
    )
    if (result.exceptionDetails != null) throw Error(this.error(result.exceptionDetails))
    const id = result.result.objectId
    if (typeof id !== 'string') return null
    try {
      const { node } = (await this.cdp.callTarget(
        frame.target,
        'DOM.describeNode',
        { objectId: id },
        { timeoutMs: timeout }
      )) as { node: { frameId?: string } }
      return typeof node.frameId === 'string' ? node.frameId : null
    } finally {
      await this.cdp
        .callTarget(frame.target, 'Runtime.releaseObject', { objectId: id }, { timeoutMs: timeout })
        .catch(() => {})
    }
  }
  private error(details: { exception?: { value?: unknown; description?: string }; text?: string }) {
    return typeof details.exception?.value === 'string'
      ? details.exception.value
      : (details.exception?.description ?? details.text ?? 'Visible DOM evaluation failed')
  }
  private async capture(work: Work) {
    if (
      !room(work.output) ||
      (work.frame.parentFrameId != null && Date.now() >= work.childDeadline)
    )
      return null
    if (work.output.reviewer == null) this.state.frame(work.tabId, work.frame)
    const elements = Math.min(
        maxElements - work.output.lines.length,
        work.maxElements ?? maxElements
      ),
      chars = Math.min(maxChars - work.output.chars, work.maxChars ?? maxChars),
      lineLimit = work.output.lines.length + elements,
      charLimit = work.output.chars + chars
    const timeout =
      work.frame.parentFrameId == null || work.requestDeadline === true
        ? remaining(work.deadline)
        : childRemaining(work.childDeadline)
    const page = await (async () => {
      const result = await this.state.evaluate(
        this.cdp,
        work.frame.target,
        work.frame.frameId,
        work.frame.loaderId,
        visibleDomExpression(chars, elements, work.clip, work.output.reviewer != null),
        { returnByValue: true, ...(timeout == null ? {} : { timeoutMs: timeout }) }
      )
      if (result.exceptionDetails != null) throw Error(this.error(result.exceptionDetails))
      return decode(result.result.value)
    })().catch((error) => {
      if (work.frame.parentFrameId != null) return null
      throw error
    })
    if (page == null) return null
    const clip = work.clip == null ? page.viewport : intersection(work.clip, page.viewport)
    if (clip == null) return { frames: [], frame: work.frame, clip }
    for (const item of page.items) {
      if (work.output.lines.length >= lineLimit || work.output.chars >= charLimit) break
      const ref =
          work.output.reviewer == null
            ? this.state.ref(work.tabId, work.frame, item.ref, clip)
            : String(work.output.reviewer.nextNodeId++),
        line = item.line.replace(`node_id=${item.ref}`, `node_id=${ref}`),
        size = line.length + (work.output.lines.length === 0 ? 0 : 1)
      if (work.output.chars + size > charLimit) break
      work.output.lines.push(line)
      work.output.chars += size
      work.output.reviewer?.capturedFrameIds.add(work.frame.frameId)
    }
    return { frames: page.frameElements, frame: work.frame, clip }
  }
  private async children(
    frame: DomFrame,
    frames: FrameElement[],
    clip: ViewportClip,
    tabId: number,
    deadline: number,
    output: Output,
    prioritized: string | undefined
  ) {
    if (!room(output)) return
    for (const element of frames) {
      if (!room(output) || Date.now() >= deadline) break
      const local = childClip(element.rect, clip)
      if (local == null) continue
      const id = await this.resolveFrame(
        frame,
        element.ref,
        childRemaining(deadline),
        output.reviewer != null
      ).catch(() => null)
      if (id == null || id === prioritized) continue
      const target =
        (await this.cdp
          .targetForFrameOrAttach(
            tabId,
            id,
            { timeoutMs: childRemaining(deadline) },
            element.url == null ? {} : { url: element.url }
          )
          .catch(() => null)) ?? frame.target
      const child = await this.capture({
        frame: {
          frameId: id,
          parentFrameId: frame.frameId,
          target,
          ...(element.size == null ? {} : { size: element.size })
        },
        childDeadline: deadline,
        output,
        tabId,
        clip: local
      })
      if (child?.clip != null)
        await this.children(
          child.frame,
          child.frames,
          child.clip,
          tabId,
          deadline,
          output,
          prioritized
        )
    }
  }
  async get(tabId: number, options: Options = {}) {
    this.state.registerCleanup(this.cdp)
    const deadline = options.timeoutMs == null ? undefined : Date.now() + options.timeoutMs
    const { frameTree } = (await this.cdp.call(
      tabId,
      'Page.getFrameTree',
      undefined,
      deadline == null ? {} : { deadlineMs: deadline, timeoutMs: options.timeoutMs }
    )) as { frameTree: { frame: { id: string; loaderId?: string } } }
    const main = frameTree.frame
    if (options.reviewer == null) this.state.begin(tabId, `${main.id}:${main.loaderId ?? ''}`)
    const priority = options.credentialFrameId === main.id ? undefined : options.credentialFrameId,
      output: Output = {
        chars: 0,
        lines: [],
        ...(options.reviewer == null ? {} : { reviewer: options.reviewer })
      }
    const first = await this.capture({
      frame: {
        frameId: main.id,
        ...(main.loaderId == null ? {} : { loaderId: main.loaderId }),
        target: { tabId }
      },
      childDeadline: Date.now() + budget,
      deadline,
      tabId,
      output,
      ...(priority == null ? {} : { maxChars: 15000, maxElements: 150 })
    })
    if (first?.clip == null || !room(output)) return output.lines.join('\n')
    let prioritized: string | undefined
    if (priority != null && (deadline == null || Date.now() < deadline)) {
      let element: FrameElement | undefined
      for (const candidate of first.frames) {
        if (deadline != null && Date.now() >= deadline) break
        if (
          (await this.resolveFrame(
            first.frame,
            candidate.ref,
            remaining(deadline) ?? childTimeout,
            output.reviewer != null
          ).catch(() => null)) === priority
        ) {
          element = candidate
          break
        }
      }
      const clip = element == null ? null : childClip(element.rect, first.clip)
      if (element != null && clip != null) {
        const target = (await this.cdp
          .targetForFrameOrAttach(
            tabId,
            priority,
            { deadlineMs: deadline, timeoutMs: remaining(deadline) },
            element.url == null ? {} : { url: element.url }
          )
          .catch(() => null)) ?? { tabId }
        const capture = await this.capture({
          frame: {
            frameId: priority,
            parentFrameId: main.id,
            ...(element.size == null ? {} : { size: element.size }),
            target
          },
          childDeadline: deadline ?? Infinity,
          deadline,
          output,
          tabId,
          requestDeadline: true,
          clip
        })
        if (capture?.clip != null) prioritized = priority
      }
    }
    await this.children(
      first.frame,
      first.frames,
      first.clip,
      tabId,
      Math.min(Date.now() + budget, deadline ?? Infinity),
      output,
      prioritized
    )
    return output.lines.join('\n')
  }
}
