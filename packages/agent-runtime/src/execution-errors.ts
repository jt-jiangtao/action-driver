export class ProcessOutputLimitError extends Error {
  readonly code = 'PROCESS_OUTPUT_LIMIT'

  constructor() {
    super('PROCESS_OUTPUT_LIMIT: command output exceeded limit')
    this.name = 'ProcessOutputLimitError'
  }
}

export class ProcessExitError extends Error {
  readonly code = 'PROCESS_EXIT_NONZERO'

  constructor(readonly exitCode: number | null) {
    super(`PROCESS_EXIT_NONZERO: ${exitCode}`)
    this.name = 'ProcessExitError'
  }
}

export class OfficeDependenciesUnavailableError extends Error {
  readonly code = 'TOOL_UNAVAILABLE'

  constructor(path: string) {
    super(`TOOL_UNAVAILABLE: bundled office dependency missing or outside deployment: ${path}`)
    this.name = 'OfficeDependenciesUnavailableError'
  }
}

export class ExecutionContextUnavailableError extends Error {
  readonly code = 'EXECUTION_CONTEXT_UNAVAILABLE'

  constructor(message = 'EXECUTION_CONTEXT_UNAVAILABLE: no persisted task owns this execution') {
    super(message)
    this.name = 'ExecutionContextUnavailableError'
  }
}
