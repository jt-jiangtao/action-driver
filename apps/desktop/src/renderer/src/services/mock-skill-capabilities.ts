import type {
  BrowserSkillInvocation,
  ComputerUseSkillInvocation,
  SkillCapability,
  SkillControlCommand,
  SkillExecutionEvent,
  SkillExecutionState,
  SkillGateway,
  SkillId,
  SkillInvocation
} from '@actiondriver/contracts'
import { SKILL_IDS } from '@actiondriver/contracts'
import { transitionSkillState } from './skill-state-machine'

const occurredAt = '2026-09-20T12:00:00.000Z'

abstract class MockSkillCapability<
  TSkillId extends SkillId,
  TInvocation extends Extract<SkillInvocation, { skillId: TSkillId }>
> implements SkillCapability<TSkillId> {
  abstract readonly skillId: TSkillId
  private readonly states = new Map<string, SkillExecutionState>()

  async invoke(invocation: TInvocation): Promise<SkillExecutionEvent> {
    this.states.set(invocation.id, 'running')
    return this.event(invocation.id, 'running')
  }

  async transition(
    invocationId: string,
    command: SkillControlCommand
  ): Promise<SkillExecutionEvent> {
    const current = this.states.get(invocationId)
    if (!current) throw new Error(`Unknown skill invocation: ${invocationId}`)
    const state = transitionSkillState(current, command)
    this.states.set(invocationId, state)
    return this.event(invocationId, state)
  }

  private event(invocationId: string, state: SkillExecutionState): SkillExecutionEvent {
    return {
      id: `event-${this.skillId}-${state}`,
      invocationId,
      skillId: this.skillId,
      state,
      occurredAt
    }
  }
}

export class MockBrowserSkillCapability extends MockSkillCapability<
  typeof SKILL_IDS.browser,
  BrowserSkillInvocation
> {
  readonly skillId = SKILL_IDS.browser
}

export class MockComputerUseSkillCapability extends MockSkillCapability<
  typeof SKILL_IDS.computer,
  ComputerUseSkillInvocation
> {
  readonly skillId = SKILL_IDS.computer
}

export class MockSkillGateway implements SkillGateway {
  private readonly invocationSkills = new Map<string, SkillId>()
  private readonly listeners = new Set<(event: SkillExecutionEvent) => void>()

  constructor(
    private readonly capabilities: {
      [SKILL_IDS.browser]: SkillCapability<typeof SKILL_IDS.browser>
      [SKILL_IDS.computer]: SkillCapability<typeof SKILL_IDS.computer>
    }
  ) {}

  async invoke(invocation: SkillInvocation): Promise<SkillExecutionEvent> {
    this.invocationSkills.set(invocation.id, invocation.skillId)
    const event =
      invocation.skillId === SKILL_IDS.browser
        ? await this.capabilities[SKILL_IDS.browser].invoke(invocation)
        : await this.capabilities[SKILL_IDS.computer].invoke(invocation)
    this.emit(event)
    return event
  }

  pause(invocationId: string): Promise<SkillExecutionEvent> {
    return this.transition(invocationId, 'pause')
  }

  resume(invocationId: string): Promise<SkillExecutionEvent> {
    return this.transition(invocationId, 'resume')
  }

  takeOver(invocationId: string): Promise<SkillExecutionEvent> {
    return this.transition(invocationId, 'take-over')
  }

  getCapability<TSkillId extends SkillId>(skillId: TSkillId): SkillCapability<TSkillId> {
    return this.capabilities[skillId] as SkillCapability<TSkillId>
  }

  subscribe(listener: (event: SkillExecutionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async transition(
    invocationId: string,
    command: SkillControlCommand
  ): Promise<SkillExecutionEvent> {
    const skillId = this.invocationSkills.get(invocationId)
    if (!skillId) throw new Error(`Unknown skill invocation: ${invocationId}`)
    const event = await this.getCapability(skillId).transition(invocationId, command)
    this.emit(event)
    return event
  }

  private emit(event: SkillExecutionEvent): void {
    this.listeners.forEach((listener) => listener(event))
  }
}
