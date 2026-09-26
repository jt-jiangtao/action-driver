/**
 * Tracks which instruction Skills the agent has actually read per conversation session. Computer Use uses it to
 * enforce that the `computer-use` Skill is loaded before any computer_* tool may run.
 */
export class LoadedSkills {
  private readonly bySession = new Map<string, Set<string>>()

  record(sessionId: string, skillId: string): void {
    const skills = this.bySession.get(sessionId) ?? new Set<string>()
    skills.add(skillId)
    this.bySession.set(sessionId, skills)
  }

  has(sessionId: string, skillId: string): boolean {
    return this.bySession.get(sessionId)?.has(skillId) ?? false
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId)
  }
}
