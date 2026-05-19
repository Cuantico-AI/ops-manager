import { NotFoundError } from '../lib/errors.js';
import type { Skill } from './_types.js';

export class SkillRegistry {
  private readonly skills = new Map<string, Skill<unknown, unknown>>();

  register(skill: Skill<unknown, unknown>): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill already registered: ${skill.id}`);
    }
    this.skills.set(skill.id, skill);
  }

  get(id: string): Skill<unknown, unknown> {
    const skill = this.skills.get(id);
    if (!skill) {
      throw new NotFoundError(`Skill not found: ${id}`);
    }
    return skill;
  }

  list(): Skill<unknown, unknown>[] {
    return [...this.skills.values()];
  }
}
