import { registerCUAGlobal } from './global-registration.js'
import { createTinyskyAlt } from './default-runtime.js'
await registerCUAGlobal(createTinyskyAlt, typeof process === 'undefined' ? {} : process.env)
