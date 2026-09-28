import type { Client, Options as MacOptions } from './window.js'
export type Direction = 'up' | 'down' | 'left' | 'right' | 'u' | 'd' | 'l' | 'r'
export type MouseButton = 'left' | 'right' | 'middle' | 'l' | 'r' | 'm'
export type Point = { x: number; y: number }
/** Only the approved macOS surface is available in this reconstruction. */
export type SkyClient = Client
export type Options = MacOptions
export type * as Window from './window.js'
