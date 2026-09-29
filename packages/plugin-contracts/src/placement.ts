import { z } from 'zod'

/**
 * Where a plugin capability may run. Placement is a separate dimension from the `local/cloud`
 * tool target and grants: choosing a location never rewrites either of them.
 */
export const PLACEMENT_LOCATIONS = ['ui', 'local-workspace', 'remote-workspace', 'cloud'] as const
export type PlacementLocation = (typeof PLACEMENT_LOCATIONS)[number]

export const PLACEMENT_DEVICES = ['display', 'input', 'filesystem', 'network'] as const
export type PlacementDevice = (typeof PLACEMENT_DEVICES)[number]

export const PLACEMENT_WORKSPACE_REQUIREMENTS = ['none', 'session-input', 'session-output', 'session-workspace'] as const
export type PlacementWorkspaceRequirement = (typeof PLACEMENT_WORKSPACE_REQUIREMENTS)[number]

/** Handshake protocol every host and plugin agrees on before placement can select it. */
export const PLACEMENT_PROTOCOL_VERSION = 1

export const placementDeclarationSchema = z
  .object({
    /** Host locations this capability supports; the plugin is only placed on one of them. */
    locations: z.array(z.enum(PLACEMENT_LOCATIONS)).min(1),
    /** Soft preference; it never overrides a missing device, workspace or grant. */
    preferred: z.enum(PLACEMENT_LOCATIONS).optional(),
    devices: z.array(z.enum(PLACEMENT_DEVICES)).optional(),
    workspace: z.enum(PLACEMENT_WORKSPACE_REQUIREMENTS).default('none'),
    protocol: z.number().int().positive().default(PLACEMENT_PROTOCOL_VERSION)
  })
  .strict()
  .refine(
    declaration => declaration.preferred === undefined || declaration.locations.includes(declaration.preferred),
    { message: 'preferred must be one of the declared locations' }
  )
export type PlacementDeclaration = z.infer<typeof placementDeclarationSchema>

/**
 * Legacy manifests carry no placement declaration. That keeps them working exactly as today (any
 * available host), while a declared plugin can be refused instead of silently placed elsewhere.
 */
export function supportsLocation(declaration: PlacementDeclaration | undefined, location: PlacementLocation): boolean {
  return declaration === undefined || declaration.locations.includes(location)
}

export function declaredDevices(declaration: PlacementDeclaration | undefined): readonly PlacementDevice[] {
  return declaration?.devices ?? []
}
