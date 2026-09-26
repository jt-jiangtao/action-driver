/**
 * Tracks which instruction Skills the agent has actually read per task. Computer Use uses it to
 * enforce that the `computer-use` Skill is loaded before any computer_* tool may run.
 */
export class LoadedSkills {
  private readonly byTask = new Map<string, Set<string>>()

  record(taskId: string, skillId: string): void {
    const skills = this.byTask.get(taskId) ?? new Set<string>()
    skills.add(skillId)
    this.byTask.set(taskId, skills)
  }

  has(taskId: string, skillId: string): boolean {
    return this.byTask.get(taskId)?.has(skillId) ?? false
  }

  clear(taskId: string): void {
    this.byTask.delete(taskId)
  }
}
