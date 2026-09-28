import { createComputerSession } from '../../cua/src/computer-session.js'
import { createMacComputer } from '../src/mac/computer.js'
export const connect = () => createComputerSession({ computer: createMacComputer() })
import { sky } from '../src/sky.js'
export const connectRpc = () => createComputerSession({ computer: sky })
