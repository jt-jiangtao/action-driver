export const ServerErrorCode = {
  senderProcessNotAuthenticated: -10000,
  couldNotGetRequestData: -10001,
  couldNotGetRequestTypeName: -10002,
  couldNotResolveRequestType: -10003,
  unhandledEvent: -10004,
  unknownError: -10005,
  appNotAllowed: -10006,
  runningApplicationNotFound: -10007,
  accessibilityError: -10008,
  permissionsNotGranted: -10009,
  invalidApp: -10010,
  noActiveSession: -10011,
  userStoppedSession: -10012,
  incompatibleClientVersion: -10013,
  permissionsPending: -10014,
  blockedURL: -10015,
  userIntervened: -10016,
  couldNotGetSenderPID: -10017,
  ambiguousApp: -10018,
  couldNotGetBootstrapPort: -10019,
  screenLocked: -10020
} as const
const names = new Map<number, string>(
  Object.entries(ServerErrorCode).map(([name, code]) => [code, name])
)
export class ComputerUseError extends Error {
  readonly code: number
  readonly errorName: string
  readonly request: unknown
  readonly requestType: string
  constructor({
    code,
    message,
    request,
    requestType
  }: {
    code: number
    message: string
    request: unknown
    requestType: string
  }) {
    super(message)
    // Wire-facing error names retain the original contract.
    this.name = 'SkyComputerUseError'
    this.code = code
    this.errorName = names.get(code) ?? 'jsonRPCError'
    this.request = request
    this.requestType = requestType
  }
}
export class ComputerUseTransportError extends Error {
  override readonly cause: unknown
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message)
    this.name = 'SkyComputerUseTransportError'
    this.cause = options.cause
  }
}
