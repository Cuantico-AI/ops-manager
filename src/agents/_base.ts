import type { SkillRegistry } from '../skills/_registry.js';
import type { SkillContext } from '../skills/_types.js';

export abstract class BaseAgent<Input, Output> {
  constructor(
    readonly id: string,
    readonly skills: SkillRegistry,
  ) {}

  abstract run(input: Input, ctx: SkillContext): Promise<Output>;
}
