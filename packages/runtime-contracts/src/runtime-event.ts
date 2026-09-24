export type RuntimeEvent = {
  cursor: number
  taskId: string
  type: string
  payload: unknown
  occurredAt: string
}
