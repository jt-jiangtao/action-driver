import { z } from 'zod/v3'
import { AtlasCommand } from '../command.js'
export function defineCommand<P extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  commandType: string,
  PayloadSchema: P,
  ResultSchema: R
) {
  return {
    commandType,
    PayloadSchema,
    ResultSchema,
    create: (payload: z.input<P>) =>
      new AtlasCommand<z.output<P>>(commandType, PayloadSchema, payload)
  }
}
export { z }
