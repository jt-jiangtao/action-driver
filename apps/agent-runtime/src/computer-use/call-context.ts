export type ComputerCallContext = {
  taskId: string
  sessionId: string
  signal?: AbortSignal
}
