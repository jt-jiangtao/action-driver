export type ParentMessageEvent = { data: unknown }

export interface ParentPortLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: ParentMessageEvent) => void): unknown
  off(event: 'message', listener: (event: ParentMessageEvent) => void): unknown
}
